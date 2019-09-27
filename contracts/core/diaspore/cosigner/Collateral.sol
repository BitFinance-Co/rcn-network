pragma solidity ^0.5.11;

import "../../../interfaces/IERC20.sol";
import "../../../interfaces/Cosigner.sol";
import "../../../interfaces/TokenConverter.sol";
import "../interfaces/Model.sol";
import "../interfaces/RateOracle.sol";
import "../utils/DiasporeUtils.sol";
import "../LoanManager.sol";

import "../../../commons/Ownable.sol";
import "../../../commons/ERC721Base.sol";
import "../../../utils/SafeERC20.sol";
import "../../../utils/SafeMath.sol";
import "../../../utils/SafeCast.sol";
import "../../../utils/SafeSignedMath.sol";
import "../../../utils/SafeTokenConverter.sol";
import "../../../utils/Math.sol";


contract Collateral is Ownable, Cosigner, ERC721Base {
    using SafeTokenConverter for TokenConverter;
    using DiasporeUtils for LoanManager;
    using SafeSignedMath for int256;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint32;
    using SafeCast for uint256;
    using SafeCast for int256;

    // This reprecent a 100.00%
    uint256 private constant BASE = 10000;

    event Created(
        uint256 indexed _entryId,
        bytes32 indexed _debtId,
        RateOracle _oracle,
        IERC20 _token,
        uint256 _amount,
        uint32 _liquidationRatio,
        uint32 _balanceRatio,
        uint32 _burnFee,
        uint32 _rewardFee,
        uint32 _maxDeltaPriceRatio
    );

    event Deposited(uint256 indexed _entryId, uint256 _amount);
    event Withdrawed(uint256 indexed _entryId, address _to, uint256 _amount);

    event Started(uint256 indexed _entryId);

    event SetMaxDeltaPriceRatio(uint256 indexed _entryId, address _sender, uint256 _maxDeltaPriceRatio);

    event PayOffDebt(uint256 indexed _entryId, uint256 _closingObligationToken, uint256 _payTokens);
    event CancelDebt(uint256 indexed _entryId, uint256 _obligationInToken, uint256 _payTokens);
    event CollateralBalance(uint256 indexed _entryId, uint256 _tokenRequiredToTryBalance, uint256 _payTokens);
    event TakeFee(uint256 indexed _entryId, uint256 _burned, address _rewardTo, uint256 _rewarded);

    event ConvertPay(uint256 indexed _entryId, uint256 _fromAmount, uint256 _toAmount, bytes _oracleData);
    event Rebuy(uint256 indexed _entryId, uint256 _fromAmount, uint256 _toAmount);

    event Redeemed(uint256 indexed _entryId);
    event EmergencyRedeemed(uint256 indexed _entryId, address _to);

    event SetUrl(string _url);
    event SetConverter(TokenConverter _converter);

    event ReadedOracle(RateOracle _oracle, uint256 _tokens, uint256 _equivalent);

    Entry[] public entries;
    // Define when cosign the debt on requestCosign function
    mapping(bytes32 => uint256) public debtToEntry;

    // Can change
    string private iurl;
    TokenConverter public converter;
    // Constant, set in constructor
    LoanManager public loanManager;
    IERC20 public loanManagerToken;

    // Set in create function
    struct Entry {
        RateOracle oracle;
        IERC20 token;
        bytes32 debtId;
        uint256 amount;
        uint32 liquidationRatio;
        uint32 balanceRatio;
        uint32 burnFee;
        uint32 rewardFee;
        uint32 maxDeltaPriceRatio;
    }

    constructor(LoanManager _loanManager) public ERC721Base("RCN Collateral Cosigner", "RCC") {
        require(address(_loanManager) != address(0), "Error loading loan manager");
        loanManager = _loanManager;
        loanManagerToken = loanManager.token();
        // Invalid entry of index 0
        entries.length ++;
    }

    function getEntriesLength() external view returns (uint256) { return entries.length; }

    /**
        @dev Sets the converter uses to convert from/to loanManagerToken to/from entry token

        @param _converter New converter
    */
    function setConverter(TokenConverter _converter) external onlyOwner {
        converter = _converter;
        emit SetConverter(_converter);
    }

    /**
        @notice Create an entry, previous need the approve of the ERC20 tokens
            Ratio: The ratio is expressed in order of BASE(10000), for example
                1% is 100
                150.00% is 15000
                123.45% is 12345

        @dev This generate an ERC721,
            The _oracle should not be the address 0
            The _liquidationRatio should be greater than BASE(10000)
            The _balanceRatio should be greater than _liquidationRatio
            The sum of _burnFee and _rewardFee should be lower than BASE(10000)
            The sum of _burnFee and _rewardFee should be less than the difference between balance ratio and liquidation ratio
            The debt should be in open status

        @param _debtId Id of the debt
        @param _oracle The oracle to get the rate between loanManagerToken and entry token
        @param _token ERC20 of the collateral
        @param _amount The amount to be transferred to the contract

        @param _liquidationRatio Ratio, when collateral ratio is lower enables the execution of the margin call
        @param _balanceRatio Ratio, expected collateral ratio after margin call execution

        @param _burnFee Ratio, The burn fee of execute a margin call or pay expired debt, this is sent to the address 0
        @param _rewardFee Ratio, The reward fee of execute a margin call or pay expired debt, this is sent to the sender of the transaction

        @param _maxDeltaPriceRatio The max delta between the price of entry oracle vs converter oracle

        @return The id of the entry
    */
    function create(
        bytes32 _debtId,
        RateOracle _oracle,
        IERC20 _token,
        uint256 _amount,
        uint32 _liquidationRatio,
        uint32 _balanceRatio,
        uint32 _burnFee,
        uint32 _rewardFee,
        uint32 _maxDeltaPriceRatio
    ) external returns (uint256 entryId) {
        // Check parameters
        require(_oracle != RateOracle(0), "Invalid oracle, cant be address 0");
        require(_liquidationRatio > BASE, "The liquidation ratio should be greater than BASE");
        uint256 totalFee = _burnFee.add(_rewardFee);
        require(totalFee < BASE, "Fee should be lower than BASE");
        require(_balanceRatio > _liquidationRatio, "The balance ratio should be greater than liquidation ratio");
        // Check underflow in previus require
        require(totalFee < _balanceRatio - _liquidationRatio, "The fee should be less than the difference between balance ratio and liquidation ratio");
        // Check status of loan, should be open
        require(loanManager.getStatus(_debtId) == 0, "Debt request should be open");
        // Create the entry, and push on entries array
        entryId = entries.push(
            Entry({
                oracle: _oracle,
                token: _token,
                debtId: _debtId,
                amount: _amount,
                liquidationRatio: _liquidationRatio,
                balanceRatio: _balanceRatio,
                burnFee: _burnFee,
                rewardFee: _rewardFee,
                maxDeltaPriceRatio: _maxDeltaPriceRatio
            })
        ) - 1;
        // Take the ERC20 tokens
        require(_token.safeTransferFrom(msg.sender, address(this), _amount), "Error pulling tokens");
        // Generate the ERC721 Token
        _generate(entryId, msg.sender);

        emit Created(
            entryId,
            _debtId,
            _oracle,
            _token,
            _amount,
            _liquidationRatio,
            _balanceRatio,
            _burnFee,
            _rewardFee,
            _maxDeltaPriceRatio
        );
    }

    /**
        @notice Set a new max delta price ratio

        @param _entryId The index of entry, inside of entries array
        @param _maxDeltaPriceRatio The max delta between the price of entry oracle vs converter oracle
    */
    function setMaxDeltaPriceRatio(
        uint256 _entryId,
        uint256 _maxDeltaPriceRatio
    ) external onlyAuthorized(_entryId) {
        entries[_entryId].maxDeltaPriceRatio = uint32(_maxDeltaPriceRatio);

        emit SetMaxDeltaPriceRatio(_entryId, msg.sender, _maxDeltaPriceRatio);
    }

    /**
        @notice Deposit an amount in an entry, previous need the approve of the ERC20 tokens

        @param _entryId The index of entry, inside of entries array
        @param _amount The amount to be transferred to the contract
    */
    function deposit(
        uint256 _entryId,
        uint256 _amount
    ) external {
        Entry storage entry = entries[_entryId];
        // Take the ERC20 tokens
        require(entry.token.safeTransferFrom(msg.sender, address(this), _amount), "Error pulling tokens");
        // Register the deposit of amount on the entry
        entry.amount = entry.amount.add(_amount);

        emit Deposited(_entryId, _amount);
    }

    /**
        @notice Withdraw an amount of an entry

        @param _entryId The index of entry, inside of entries array
        @param _to The beneficiary of the tokens
        @param _amount The amount to be subtract of the entry
        @param _oracleData Data of oracle to change the currency of debt
            to Token of debt engine
    */
    function withdraw(
        uint256 _entryId,
        address _to,
        uint256 _amount,
        bytes calldata _oracleData
    ) external onlyAuthorized(_entryId) {
        Entry storage entry = entries[_entryId];

        if (debtToEntry[entry.debtId] != 0) { // The entry is cosigned
            // Read oracle
            (uint256 debtRateTokens, uint256 debtRateEquivalent) = loanManager.readOracle(entry.debtId, _oracleData);
            // Check if can withdraw the amount
            require(_amount.toInt256() <= canWithdraw(_entryId, debtRateTokens, debtRateEquivalent), "Dont have collateral to withdraw");
        } else { // The entry isn't cosigned
            // Check if can withdraw the amount
            require(_amount <= entry.amount, "Dont have collateral to withdraw");
        }
        // Send the amount of ERC20 tokens to _to
        require(entry.token.safeTransfer(_to, _amount), "Error sending tokens");
        // Register the withdraw of amount on the entry
        entry.amount = entry.amount.sub(_amount);

        emit Withdrawed(_entryId, _to, _amount);
    }

    /**
        @notice Redeem/Forgive an entry, only an authorized can be use this function
            The state of the debt must be request(0)
            The state of the debt must be paid(2)

        @dev call _redeem function with false in _emergency parameter
            * look in _redeem function documentation for more info

        @param _entryId The index of entry, inside of entries array

        @return The amount of transferred tokens
    */
    function redeem(
        uint256 _entryId
    ) external onlyAuthorized(_entryId) returns(uint256) {
        return _redeem(_entryId, msg.sender, false);
    }

    /**
        @notice Redeem/Forgive an entry, only owner of contract can be use this function
            The state of the debt must be ERROR(4)

        @dev call _redeem function with true in _emergency parameter
            * look in _redeem function documentation for more info

        @param _entryId The index of entry, inside of entries array
        @param _to The beneficiary of the tokens

        @return The amount of transferred tokens
    */
    function emergencyRedeem(
        uint256 _entryId,
        address _to
    ) external onlyOwner returns(uint256) {
        return _redeem(_entryId, _to, true);
    }

    /**
        @notice Redeem/Forgive an entry

        @dev Send the balance of the entry to _to and delete the entry

        @param _entryId Id of the entry
        @param _to The beneficiary of the tokens
        @param _emergency Boolean:
            True, look in emergencyRedeem function
            False, look in redeem function

        @return The amount of transferred tokens
    */
    function _redeem(
        uint256 _entryId,
        address _to,
        bool _emergency
    ) internal returns(uint256 totalTransfer) {
        Entry storage entry = entries[_entryId];
        // Get debt status
        uint256 status = loanManager.getStatus(entry.debtId);

        if (_emergency) {
            // The state of the debt must be ERROR(4)
            require(status == 4, "Debt is not in error");
            emit EmergencyRedeemed(_entryId, _to);
        } else {
            // The state of the debt must be request(0) or paid(2)
            require(status == 0 || status == 2, "Debt not request or paid");
            emit Redeemed(_entryId);
        }

        totalTransfer = entry.amount;
        // Send the amount of ERC20 tokens to _to
        require(entry.token.safeTransfer(_to, totalTransfer), "Error sending tokens");

        // Destroy ERC721 collateral token
        delete debtToEntry[entry.debtId];
        delete entries[_entryId];
    }

    /**
        @notice Pay a debt with the entry balance, only an authorized can be use this function

        @dev Convert the necessary amount of Token of the entry in Loan Manager Token to try pay all the debt

        @param _entryId Id of the entry
        @param _oracleData Data of oracle to change the currency of debt
            to Token of debt engine

        @return The amount of paid tokens
    */
    function payOffDebt(
        uint256 _entryId,
        bytes calldata _oracleData
    ) external onlyAuthorized(_entryId) returns(uint256 payTokens) {
        Entry storage entry = entries[_entryId];
        bytes32 debtId = entry.debtId;
        Model model = Model(loanManager.getModel(uint256(debtId)));

        // Get the closing obligation
        uint256 closingObligation = model.getClosingObligation(debtId);
        // Transform the closing obligation to tokens using the rate of oracle
        uint256 closingObligationToken = loanManager.amountToToken(debtId, _oracleData, closingObligation);
        // Read entry oracle
        (uint256 entryRateTokens, uint256 entryRateEquivalent) = entry.oracle.readSample("");
        emit ReadedOracle(entry.oracle, entryRateTokens, entryRateEquivalent);
        // Convert the tokens of the entry to LoanManager Token and pay the debt
        payTokens = _convertPay(
            _entryId,
            closingObligationToken,
            getPrice(entryRateTokens, entryRateEquivalent),
            _oracleData,
            false
        );

        emit PayOffDebt(_entryId, closingObligationToken, payTokens);
    }

    // ///
    // Cosigner methods
    // ///

    /**
        @dev Sets the url to retrieve the data for "requestCosign"

        @param _url New url
    */
    function setUrl(string calldata _url) external onlyOwner {
        iurl = _url;
        emit SetUrl(_url);
    }

    /**
        @notice Returns the cost of the cosigner

        This cosigner does not have any risk or maintenance cost, so its free.

        @return 0, because it's free
    */
    function cost(
        address,
        uint256,
        bytes memory,
        bytes memory
    ) public view returns (uint256) {
        return 0;
    }

    function url() public view returns (string memory) {
        return iurl;
    }

    /**
        @notice Request the cosign of a debt

        @dev This function should be send by the loanManager

        @param _debtId Id of the debt
        @param _data Data with the entry index
        @param _oracleData Data of oracle to change the currency of debt
            to Token of debt engine

        @return true If the cosign was done
    */
    function requestCosign(
        address,
        uint256 _debtId,
        bytes memory _data,
        bytes memory _oracleData
    ) public returns (bool) {
        // Load entryId and entry
        bytes32 debtId = bytes32(_debtId);
        uint256 entryId = abi.decode(_data, (uint256));
        Entry storage entry = entries[entryId];

        // Check if the entry its collateralized, the ratio collateral/debt should be greator than balanceRatio
        (uint256 debtRateTokens, uint256 debtRateEquivalent) = loanManager.readOracle(debtId, _oracleData);
        // Read entry oracle
        (uint256 entryRateTokens, uint256 entryRateEquivalent) = entry.oracle.readSample("");
        emit ReadedOracle(entry.oracle, entryRateTokens, entryRateEquivalent);
        // Valuate the debt amount from debt currency to loanManagerToken
        uint256 debt = debtInTokens(entryId, debtRateTokens, debtRateEquivalent);
        // Check if the entry its collateralized
        require(
            balanceDeltaRatio(
                entryId,
                debt,
                entryRateTokens,
                entryRateEquivalent
            ) >= 0, "The entry its not collateralized"
        );

        // Validate call from loan manager
        require(entry.debtId == debtId, "Wrong debt id");
        require(address(loanManager) == msg.sender, "Not the debt manager");

        // Save entryId
        debtToEntry[debtId] = entryId;

        // Cosign
        require(loanManager.cosign(_debtId, 0), "Error performing cosign");

        emit Started(entryId);

        return true;
    }

    /**
        @notice Execute a pay of a expired debt or a margin call

        @dev There are two important behaviors:
            Execute a pay of a expired debt, transform the Token of the entry to LoanManager Token
                to pay the expired part of the debt and the fees
            Execute a margin call, transform the Token of the entry to LoanManager Token to pay a
                part(the minimum amount required to equilibrate the balance) of the debt and the fees,
                to try balance the collateral ratio

        @param _debtId Id of the debt
        @param _oracleData Data of oracle to change the currency of debt
            to Token of debt engine

        @return true If execute a pay debt or a margin call
    */
    function claim(
        address,
        uint256 _debtId,
        bytes memory _oracleData
    ) public returns (bool change) {
        bytes32 debtId = bytes32(_debtId);
        uint256 entryId = debtToEntry[debtId];
        require(entryId != 0, "The loan dont lent");

        Model model = Model(loanManager.getModel(_debtId));
        uint256 dueTime = model.getDueTime(debtId);
        //Entry storage entry = entries[entryId];

        uint256 entryRateTokens;
        uint256 entryRateEquivalent;

        if (block.timestamp >= dueTime) { // Expired debt
            // Run payment of debt, use collateral to buy tokens
            (uint256 obligation,) = model.getObligation(debtId, uint64(dueTime));
            // Valuate the debt amount from debt currency to loanManagerToken
            uint256 obligationToken = loanManager.amountToToken(debtId, _oracleData, obligation);
            // Read entry oracle
            (entryRateTokens, entryRateEquivalent) = entries[entryId].oracle.readSample("");
            emit ReadedOracle(entries[entryId].oracle, entryRateTokens, entryRateEquivalent);
            // Convert the tokens of the entry to LoanManager Token and pay the debt
            uint256 payTokens = _convertPay(
                entryId,
                obligationToken,
                getPrice(entryRateTokens, entryRateEquivalent),
                _oracleData,
                true
            );

            emit CancelDebt(entryId, obligationToken, payTokens);

            change = true;
        }

        // Read debt oracle
        (uint256 debtRateTokens, uint256 debtRateEquivalent) = loanManager.readOracle(debtId, _oracleData);
        // Read entry oracle
        (entryRateTokens, entryRateEquivalent) = entries[entryId].oracle.readSample("");
        emit ReadedOracle(entries[entryId].oracle, entryRateTokens, entryRateEquivalent);

        // Get the minimum amount required to balance the collateral ratio
        uint256 tokenRequiredToTryBalance = getTokenRequiredToTryBalance(
            entryId,
            debtRateTokens,
            debtRateEquivalent,
            entryRateTokens,
            entryRateEquivalent
        );

        if (tokenRequiredToTryBalance > 0) {
            // Run margin call, buy required tokens
            // and substract from total collateral
            uint256 payTokens = _convertPay(
                entryId,
                tokenRequiredToTryBalance,
                getPrice(entryRateTokens, entryRateEquivalent),
                _oracleData,
                true
            );

            emit CollateralBalance(entryId, tokenRequiredToTryBalance, payTokens);

            change = true;
        }
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _burnFee The entry burn fee
        @param _rewardFee The entry reward fee
        @param _amountInToken The amount(valuate in loanManagerToken)
            from where the fee is taken

        @return The total fee taken(burn plus reward)
    */
    function _takeFee(
        uint256 _entryId,
        uint256 _burnFee,
        uint256 _rewardFee,
        uint256 _amountInToken
    ) internal returns(uint256 feeTaked) {
        // Take the burn fee
        uint256 burned = _takeFeeTo(
            _amountInToken,
            _burnFee,
            address(0)
        );
        // Take the reward fee
        uint256 reward = _takeFeeTo(
            _amountInToken,
            _rewardFee,
            msg.sender
        );

        feeTaked = reward.add(burned);

        if (feeTaked != 0)
            emit TakeFee(
                _entryId,
                burned,
                msg.sender,
                reward);
    }

    /**
        @param _amountInToken The amount(valuate in loanManagerToken)
            from where the fee is taken
        @param _fee The fee ratio
        @param _to The destination of the tokens

        @return The total fee taken(burn plus reward)
    */
    function _takeFeeTo(
        uint256 _amountInToken,
        uint256 _fee,
        address _to
    ) internal returns(uint256 taked) {
        if (_fee == 0) return 0;

        taked = _fee.mult(_amountInToken) / BASE;

        require(loanManagerToken.transfer(_to, taked), "Error sending tokens");
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _requiredToken The required amount to pay in loanManager token
        @param _oracleData Data of oracle to change the currency of debt
            to Token of debt engine
        @param _chargeFee If charge fee

        @return The minimum amount valuate in collateral token of:
            collateral required to balance the entry
            entry amount
    */
    function _convertPay(
        uint256 _entryId,
        uint256 _requiredToken,
        uint256 _expecPrice,
        bytes memory _oracleData,
        bool _chargeFee
    ) internal returns(uint256 paidTokens) {
        Entry storage entry = entries[_entryId];
        // Target buy
        uint256 targetBuy;

        if (_chargeFee) {
            targetBuy = _requiredToken.mult(
                BASE + entry.rewardFee + entry.burnFee
            ) / BASE;
        } else {
            targetBuy = _requiredToken;
        }

        // Use collateral to buy tokens
        (uint256 bought, uint256 sold) = converter.safeConvertToMax(
            entry.token,      // Token to sell
            loanManagerToken, // Token to buy
            targetBuy,        // Target buy amount in buy token
            entry.amount      // Max amount to sell in sell token
        );

        // Check delta price ratio(oracle vs converter)
        require(deltaPriceRatio(bought, sold, _expecPrice) <= entry.maxDeltaPriceRatio, "The delta price its to high");

        uint256 feeTaked = _chargeFee ? _takeFee(_entryId, entry.burnFee, entry.rewardFee, Math.min(bought, _requiredToken)) : 0;
        uint256 tokensToPay = Math.min(bought, targetBuy).sub(feeTaked);

        // Pay debt
        (, paidTokens) = loanManager.safePayToken(
            entry.debtId,
            tokensToPay,
            address(this),
            _oracleData
        );

        emit ConvertPay(
            _entryId,
            sold,
            bought,
            _oracleData
        );

        if (paidTokens < tokensToPay) {
            // Buy back extra collateral
            sold = tokensToPay - paidTokens;
            bought = converter.safeConvertFrom(
                loanManagerToken,
                entry.token,
                sold,
                0
            );
            emit Rebuy(_entryId, sold, bought);
        } else {
            bought = 0;
        }

        entry.amount = entry.amount.sub(sold).add(bought);
    }

    // Collateral methods

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtRateTokens Rate in loanManagerToken
        @param _debtRateEquivalent Equivalent rate in debt currency

        @return The minimum amount valuate in collateral token of:
            collateral required to balance the entry
            entry amount
    */
    function getTokenRequiredToTryBalance(
        uint256 _entryId,
        uint256 _debtRateTokens,
        uint256 _debtRateEquivalent,
        uint256 _entryRateTokens,
        uint256 _entryRateEquivalent
    ) public returns(uint256) {
        Entry storage entry = entries[_entryId];
        // Valuate the debt amount from debt currency to loanManagerToken
        uint256 debt = debtInTokens(_entryId, _debtRateTokens, _debtRateEquivalent);
        // If the debt amount its 0 dont need balance the entry
        if (debt == 0) return 0;

        // If the entry is collateralized should not have collateral amount to pay
        if (liquidationDeltaRatio(
            _entryId,
            debt,
            _entryRateTokens,
            _entryRateEquivalent
        ) >= 0) {
            return 0;
        }

        uint256 cwithdraw = canWithdraw(_entryId, debt).abs().toUint256();

        // Check underflow when create the entry
        uint256 collateralRequiredToBalance = cwithdraw.mult(BASE) / (entry.balanceRatio - BASE - entry.burnFee - entry.rewardFee);

        uint256 min = Math.min(
            // The collateral required to equilibrate the balance (the collateral should be more than the debt)
            collateralRequiredToBalance,
            // Pay all collateral amount (the collateral should be less than the debt)
            entry.amount
        );

        return collateralToTokens(
            entry.token,
            min,
            _entryRateTokens,
            _entryRateEquivalent
        );
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtRateTokens Rate in loanManagerToken
        @param _debtRateEquivalent Equivalent rate in debt currency

        @return The amount that can be withdraw of the collateral, valuate in collateral Token.
            If the return its negative, the entry should be below of the balance ratio
    */
    function canWithdraw(
        uint256 _entryId,
        uint256 _debtRateTokens,
        uint256 _debtRateEquivalent
    ) public returns (int256) {
        // Valuate the debt amount from debt currency to loanManagerToken
        uint256 debtInToken = debtInTokens(_entryId, _debtRateTokens, _debtRateEquivalent);

        return canWithdraw(_entryId, debtInToken);
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtInToken The total amount of the debt valuate in loanManagerToken

        @return The amount that can be withdraw of the collateral, valuate in collateral Token.
            If the return its negative, the entry should be below of the balance ratio
    */
    function canWithdraw(
        uint256 _entryId,
        uint256 _debtInToken
    ) public returns (int256) {
        Entry storage entry = entries[_entryId];
        // Read entry oracle
        (uint256 entryRateTokens, uint256 entryRateEquivalent) = entry.oracle.readSample("");
        emit ReadedOracle(entry.oracle, entryRateTokens, entryRateEquivalent);

        int256 ratio = collateralRatio(
            _entryId,
            _debtInToken,
            entryRateTokens,
            entryRateEquivalent
        ).toInt256();
        int256 collateral = entry.amount.toInt256();
        // if the collateralRatio its 0 can withdraw all the collateral, because the debt amount its 0
        if (ratio == 0) return collateral;

        int256 delta = balanceDeltaRatio(
            _entryId,
            _debtInToken,
            entryRateTokens,
            entryRateEquivalent
        );
        return collateral.muldiv(delta, ratio);
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtInToken The total amount of the debt valuate in loanManagerToken
        @param _entryRateTokens Rate in loanManagerToken
        @param _entryRateEquivalent Equivalent rate in entry token

        @return The collateral ratio minus the liquidation ratio
    */
    function liquidationDeltaRatio(
        uint256 _entryId,
        uint256 _debtInToken,
        uint256 _entryRateTokens,
        uint256 _entryRateEquivalent
    ) public view returns (int256) {
        return collateralRatio(
            _entryId,
            _debtInToken,
            _entryRateTokens,
            _entryRateEquivalent
        ).toInt256().sub(int256(entries[_entryId].liquidationRatio));
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtInToken The total amount of the debt valuate in loanManagerToken
        @param _entryRateTokens Rate in loanManagerToken
        @param _entryRateEquivalent Equivalent rate in entry token

        @return The collateral ratio minus the balance ratio
    */
    function balanceDeltaRatio(
        uint256 _entryId,
        uint256 _debtInToken,
        uint256 _entryRateTokens,
        uint256 _entryRateEquivalent
    ) public view returns (int256) {
        return collateralRatio(
            _entryId,
            _debtInToken,
            _entryRateTokens,
            _entryRateEquivalent
        ).toInt256().sub(int256(entries[_entryId].balanceRatio));
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtInToken The total amount of the debt valuate in loanManagerToken
        @param _entryRateTokens Rate in loanManagerToken
        @param _entryRateEquivalent Equivalent rate in entry token

        @return The ratio of the collateral vs the debt
    */
    function collateralRatio(
        uint256 _entryId,
        uint256 _debtInToken,
        uint256 _entryRateTokens,
        uint256 _entryRateEquivalent
    ) public view returns (uint256) {
        // if the debt amount its 0 the collateal ratio its 0
        if (_debtInToken == 0) return 0;

        Entry storage entry = entries[_entryId];

        uint256 collateralInTokens = collateralToTokens(
            entry.token,
            entry.amount,
            _entryRateTokens,
            _entryRateEquivalent
        );

        return collateralInTokens.multdiv(BASE, _debtInToken);
    }

    /**
        @param _entryToken The token of entry
        @param _amount The amount in loanManagerToken
        @param _entryRateTokens Rate in loanManagerToken
        @param _entryRateEquivalent Equivalent rate in entry token

        @return The _amount valuate in loanManagerToken
    */
    function collateralToTokens(
        IERC20 _entryToken,
        uint256 _amount,
        uint256 _entryRateTokens,
        uint256 _entryRateEquivalent
    ) public view returns (uint256) {
        if (_entryToken == loanManagerToken) {
            return _amount;
        } else {
            return _amount.multdiv(_entryRateTokens, _entryRateEquivalent);
        }
    }

    /**
        @param _entryId The index of entry, inside of entries array
        @param _debtRateTokens Rate in loanManagerToken
        @param _debtRateEquivalent Equivalent rate in debt currency

        @return The _amount of the debt valuate in loanManagerToken
    */
    function debtInTokens(
        uint256 _entryId,
        uint256 _debtRateTokens,
        uint256 _debtRateEquivalent
    ) public view returns (uint256) {
        uint256 debt = loanManager.getClosingObligation(entries[_entryId].debtId);

        if (_debtRateTokens == 0 && _debtRateEquivalent == 0) {
            return debt;
        } else {
            debt = debt.multdiv(_debtRateTokens, _debtRateEquivalent);
            if (debt == 0) {
                return 1;
            } else {
                return debt;
            }
        }
    }

    /**
        @return The price rate
    */
    function getPrice(
        uint256 x,
        uint256 y
    ) internal pure returns(uint256) {
        return x.multdiv(1000000000000000000, y);
    }

    /**
        @param _bought The bought amount
        @param _sold The sold amount
        @param _expecPrice The expected rate obtain by the entry oracle

        @return The delta of bought/sold price vs expecRate in Ratio
    */
    function deltaPriceRatio(
        uint256 _bought,
        uint256 _sold,
        uint256 _expecPrice
    ) internal pure returns(uint256) {
        uint256 price = getPrice(_bought, _sold);
        uint256 deltaDelta = price > _expecPrice ? price - _expecPrice : _expecPrice - price;

        return (deltaDelta * BASE) / _expecPrice;
    }
}