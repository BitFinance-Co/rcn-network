pragma solidity ^0.5.0;

import "./../../../interfaces/Token.sol";

import "./../../../utils/ERC721Base.sol";


contract Events {
    event Created(
        uint256 _pairId,
        address _owner,
        address _erc20,
        uint256 _amount
    );

    event Deposit(
        uint256 _pairId,
        address _sender,
        uint256 _amount
    );

    event Destroy(
        uint256 _pairId,
        address _sender,
        address _to,
        uint256 _amount
    );
}


contract Poach is ERC721Base, Events {
    using SafeMath for uint256;

    address constant internal ETH = 0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;

    struct Pair {
        Token token;
        uint256 amount;
    }

    Pair[] public poaches;

    constructor() public {
        poaches.length++;
    }

    /**
        @notice Create a pair and push into the poaches array

        @param _token Token address (ERC20)
        @param _amount Token amount

        @return _id Index of pair in the poaches array
    */
    function create(
        address _token,
        uint256 _amount
    ) external payable returns (uint256 _id) {
        _deposit(_token, _amount);

        _id = poaches.push(Pair(token, amount, true)) - 1;

        _generate(_id, msg.sender);

        emit Created(_id, msg.sender, token, _amount);
    }

    /**
        @notice Deposit an amount of token in a pair

        @dev If the currency its ether and the destiny its a contract, execute the payable deposit()

        @param _id Index of pair in poaches array
        @param _amount Token amount

        @return true If the operation was executed
    */
    function deposit(
        uint256 _id,
        uint256 _amount
    ) external payable returns (bool) {
        Pair storage pair = poaches[_id];
        require(pair.amount != 0, "The pair not exists");

        _deposit(pair.token, _amount);

        pair.amount += _amount;

        emit Deposit( _id, msg.sender, _amount);

        return true;
    }

    /**
        @notice Destroy a pair and return the funds

        @param _id Index of pair in poaches array
        @param _to The beneficiary of returned funds

        @return true If the operation was executed
    */
    function destroy(
        uint256 _id,
        address _to
    ) external onlyAuthorized(_id) returns (bool) {
        require(_to != 0x0, "_to should not be 0x0");
        Pair storage pair = poaches[_id];
        uint256 amount = pair.amount;
        require(amount != 0, "The pair not exists");

        if (address(pair.token) != ETH)
            require(pair.token.transfer(_to, amount), "Error transfer tokens");
        else
            _to.transfer(amount);

        delete (pair.amount);

        emit Destroy(_id, msg.sender, _to, amount);

        return true;
    }

    function _deposit(
        address _token,
        uint256 _amount
    ) internal {
        if (msg.value == 0)
            require(Token(_token).transferFrom(msg.sender, this, _amount), "Error pulling tokens");
        else
            require(_amount == msg.value && _token == ETH, "The amount should be equal to msg.value and the _token should be ETH");
    }
}