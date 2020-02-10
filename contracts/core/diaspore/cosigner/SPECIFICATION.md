# RCN Collateral cosigner

The RCN Collateral is a set of contracts that allows any Ethereum address to offer a payment guarantee for any RCN Diaspore loan. Such guarantee is provided through an overcollateralized deposit of ERC20 tokens. The exact conditions of the loan and collateral are determined only by the lender and creator of collateral.

Any Ethereum address can create a "collateral entry" for any open loan request of the RCN LoanManager, this collateral entry is not owned by the borrower of the loan, but by the creator of the collateral. Any ERC20 token can be used as collateral.

The only requirement is an Oracle that provides an exchange rate between such ERC20 token and the base token RCN; any Oracle would be valid as long as it complies with the RateOracle RCN specification.

Multiple collateral entries pointing to the same loan can exist, although only one entry can be activated when the loan is lent. Collateral creators can withdraw funds from the collateral if such entry is not being used on an existing loan, or if the collateral exceeds the liquidation ratio.

## Contracts

### Colateral.sol

Handles the creation and consignment of the collateral entries; ownership of each entry is represented through an ERC721 token. The creation of new entries is a permissionless process performed by the function `create()`. 

The funds of all collateral entries are stored on this contract, except the funds of entries that are in the process of being liquidated through an auction.

### CollateralLib.sol

Defines the rules and schemes of the collateral entries, abstracting the definitions of `ratio`, `balance`, `canWithdraw`, and `inLiquidation`; for better readability and testing purposes. `Collateral.sol` makes internal use of this library.

### CollateralAuction.sol

The system uses a dutch auction to sell the ERC20 collateral token for `baseToken` (RCN), a semi-fixed amount of `baseToken` is requested at the creation of the auction, and a maximum amount of collateral is offered in exchange. The amount of collateral offered for the constant amount of `baseToken`  increases every second, improving the offer until a keeper pays the debt in liquidation in order to retire the collateral. The full amount of the collateral may or may not be fully expended, and the requested baseToken may or may not be obtained.

### CollateralDebtPayer.sol

This helper contract is used to pay a loan using collateral, it borrows collateral of a given entry and uses the tokens to pay the accrued debt, those tokens may be converted to `baseToken`, the conversion is handled by a provided `TokenConverter` contract.

## Mechanics

### Creating a collateral

Collateral creation is a permissionless process that can be performed by any address; each collateral entry is linked to a loan request, and multiple collateral entries can be linked to the same request.

To create a new collateral entry, a creator must call the method `create()` of the Collateral.sol contract, with the following parameters:

| Parameter | Type | Description |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _debtId | bytes32 | The ID identifier of a loan request on the LoanManager of RCN Basalt, the loan request should be Open (status `0`). |
| _oracle | RateOracle | The address of an oracle contract compliant with the RateOracle interface specification, must also point to an ERC20 token for it to be used as the collateral token. |
| _amount | uint256 | Amount of tokens to be provided as collateral, the amount is pulled from the `msg.sender`. |
| _liquidationRatio | Fixed223x32 | Ratio of debt/collateral liquidation threshold on which the collateral position enters a liquidation auction, must be above 100%. |
| _balanceRatio | Fixed223x32 | Ratio debt/collateral target to be reached after a liquidation trigger by `_liquidationRatio`, must be above `_liquidationRatio`. |

The token used as collateral is defined by the method `token()` of the provided `_oracle`, the amount of tokens is pulled from the `msg.sender` address and stored on the `Collateral.sol` contract. An ERC721 token with an auto-incremental ID is minted and transferred to the `msg.sender` address.

### Cosignment

For a collateral entry to be used with a loan the lender of the loan has to request the consignment of `Collateral.sol` during the `lend()` process, previous of the consignment the collateral is not tied to the loan and the owner can withdraw it at any time.

The consignment can't be performed by calling directly to `requestCosign()`, such call it's only acceptable if it comes through the `LoanManager` contract. A lender that intends to lend a loan with collateral attached to it should pass the address of `Collateral.sol` (`_cosigner`) and a bytes array containing the collateral ID (`_cosignerData`), during the `lend()` call.

The passed collateral ID specifies which collateral entry is going to be used as collateral for the loan.

The consignment requires that the `collateral/debt` ratio to be above the defined `_liquidationRatio`, and this is intended to impede the owner of the collateral to front-run the `lend` transaction with a `withdraw` transaction.

### Deposit

A user may need to increase the collateralization ratio to avoid a liquidation event; this can be done by paying part of the debt, or by depositing additional collateral into the entry. Any address can perform both processes without needing the authorization of the owner of the entry.

A deposit increases the total amount of collateral of the entry, hence increasing its debt ratio, without creating a new one or changing any other explicit properties.

The deposit of additional collateral can be made at any time, even after the debt is paid or before it's cosigned, the only scenario on which deposit isn't allowed is during a liquidation auction, in which case any deposit transaction reverts.

### Withdraw

A user may decide to withdraw some collateral if the entry is above `liquidationRatio` with enough margin or if it wants to cancel the collateral entry before the consignment.

If the collateral hasn't cosigned a loan, the owner can withdraw the complete balance of the entry. If the entry is already attached to a loan, the owner it's allowed to withdraw up to reaching the `liquidationRatio`, additional withdraw calls would revert. 

Only the owner of the entry and his authorized addresses are allowed to withdraw collateral; the withdrawal of collateral decreases the total amount of collateral of an entry, decreasing its debt ratio.

Withdrawal of collateral can be performed at any time; if the loan is ongoing the maximum amount to withdraw is determined by its `liquidationRatio`. Still, at any other time, the total of the collateral can be withdrawn, the only scenario on which withdrawals aren't allowed is during a liquidation auction, in which case the withdrawal transaction reverts.

### Liquidation

There are two conditions that result in triggering a liquidation process. Liquidation consists in the offering a part or all of the collateral locked in the Colateral.sol art or all the collateral is used to pay part or all the debt; the liquidation mechanism is a dutch auction, which also determines the real collateralization ratio of the entry.

Liquidations are triggered by calling the method `claim()`; the method validates the liquidation conditions and proceeds to create an auction if those conditions are met. The method is expected to be called by the `lender`, but any address can trigger the liquidation.

#### Overdue liquidation

A collateral liquidation can be triggered if the borrower of the attached loan incurs into overdue debt. A loan is considered overdue when the current block timestamp exceeds the `getDueTime` defined by the loan model, without a grace period.

When such liquidation is triggered, the system creates an auction intending the payment of the obligation up to the `dueTime`, value that is provided by the method `getObligation` of the loan model; an additional 5% of base tokens (RCN) are requested to account for oracle rate changes and accrued interest.

In addition to the liquidation process, exceeding the getDueTime triggers the penalty rate, with the debt overdue being the capital on which the penalty interest is calculated. 

#### Ratio liquidation

A collateral liquidation can be triggered if the current collateral ratio passes below the defined `liquidationRatio`.

#### Liquidation mechanism

During the liquidation, the system creates an auction requesting enough base tokens to pay the debt and move the collateral ratio up to the defined `balanceRatio`, in exchange the system offers an amount of collateral tokens. It's unlikely that when the auction gets closed, the resulting collateral ratio becomes exactly `balanceRatio`. The balance ratio acts as a goal for the collateral to debt ratio resulting, not to be too close to the `balanceRatio`, thus in danger to go below the latter and forcing a new liquidation.

#### Priority

Only one auction per collateral entry can exist at the same time, in the case of both liquidation conditions being met at the same time, the `overdue` liquidation has priority.

### Dutch auction

A Dutch auction is the mechanism used to assign a fair exchange rate between collateral tokens and baseToken. Each liquidation triggers a unique auction. When the auction is completed, the accrued base tokens are used to pay the debt associated with the collateral, and any extra is sent to the collateral owner's address.

#### First stage

When the auction is created, an initial exchange rate of `market - 5%` is defined, `market` being provided by the oracle of the entry. The exchange rate increases to match the market second by second, and after 10 minutes, the exchange rate equals the one provided by the oracle.

The exchange rate is  offers more collateral for the same requested amount of base until a buyer is found or the auction runs out of collateral (all collateral is offered on the auction). The function that drives the price up is the following:

TODO - Add function

#### Second stage

The second stage is only reached when the loan is considered under-collateralized. In that case, the total amount of collateral is offered in exchange on an ever decreasing amount of base tokens. This asked amount starts on the requested by the liquidation trigger and linearly goes down to zero in 24 hours.

In case of not finding a buyer during the second stage, such a second stage, it's repeated.

TODO - Add function

#### Taking the auction

Any address can bid in an ongoing auction, as long as the address can provide the requested base tokens (RCN). During the taking process, the collateral is first transferred to the taker, an optional callback to the taker address can be requested to perform arbitrage, and finally, the base tokens are transferred from the taker address.

The taker is also requested to provide a valid `oracleData` if the loan oracle requires it, and also enogh gas to perform the payment of the loans.

### Collateral borrowing

The owner of the collateral entry can withdraw all collateral at any time,  the sole condition being that after the end of the transaction, the collateral ratio of the loan must be above or equal to the ratio at the beginning of the transaction.

This mechanism is intended to allow a borrower to re-pay a loan using his locked collateral; this is performed using the `CollateralDebtpayer.sol` contract, which uses a part of the collateral tokens, sells it to a token converter, and uses it to pay the debt totally or partially.

## Collateral Library

The CollateralLib library contains the formulas and conditions to create, balance, and liquidate collaterals. Each collateral is related to a `debt` amount that's not defined in the library, and it's provided on each call that requires it.

### Oracle

A price feed for the basToken (RCN). As the debt and the collateral may be expressed in a different currency from the baseToken, an exchange rate is needed to compare the debt and the collateral in the same currency. 

#### Ratio (Debt ratio)

The `ratio` (or `debt ratio`) of the collateral is determined by what percentage of the total `debt` is covered by the provided collateral. The value in `base` of the collateral is provided by the oracle.

The total `debt` is not defined in the CollateralLib contract and instead is taken as a parameter. The Collateral contract defines it to be the value provided by `getClosingObligation()` on the loan model.

This value is returned as a Fixed223x32 number; Solidity does not natively support operators for this type, the Fixed223x32 library can be used alternately.

### Balance

The `balance()` method of the CollateralLib library returns how much `collateral` should be used to pay a debt in order for the `ratio` to reach `balanceRatio`. This method is used in the context of a `Ratio Liquidation`.

This method returns an estimated amount, and it's not 100% precise, because it depends on the real liquidation rate, a value that's determined by the auction process.

### Can withdraw

The `canWithdraw()` method defines how much `collateral` can be withdrawn while keeping the collateral ratio above the `liquidationRatio`; this value depends on the `debt` that is provided.

### In Liquidation

A Collateral is considered "in liquidation" when its ratio is below `liquidationRatio`.
