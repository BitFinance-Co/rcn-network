# RCN Collateral cosigner

The RCN Collateral is a set of contracts that allows any Ethereum address to offer a payment guarantee for any RCN Diaspore loan; such guarantee is provided through an overcollateralized deposit of ERC20 tokens, the exact conditions of the loan and collateral are determined only by the lender and creator of collateral.

Any Ethereum address can create a "collateral entry" for any open loan request of the RCN LoanManager, this collateral entry is not owned by the borrower of the loan, but by the creator of the collateral. Any ERC20 token can be used as collateral.

The only requirement is an Oracle that provides an exchange rate between such ERC20 token and the base token RCN; any Oracle would be valid as long as it complies with the RateOracle RCN specification.

Multiple collateral entries pointing to the same loan can exist, although only one entry can be activated when the loan its lent. Collateral creators can withdraw funds from the collateral if such entry is not being used on an existing loan, or if the collateral exceeds the liquidation ratio.

## Contracts

### Colateral.sol

Handles the creation and consignment of the collateral entries; ownership of each entry is represented through an ERC721 token. The creation of new entries is a permissionless process performed by calling `create()`. 

The funds of all collateral entries are stored on this contract, except the funds of entries that are in the process of being liquidated through an auction.

### CollateralLib.sol

Defines the rules and schemes of the collateral entries, abstracting the definitions of `ratio`, `balance`, `canWithdraw`, and `inLiquidation`; for better readability and testing purposes. `Collateral.sol` makes internal use of this library.

### CollateralAuction.sol

The system uses a dutch auction to sell the ERC20 collateral token for `baseToken` (RCN), a semi-fixed amount of `baseToken` is requested at the creation of the auction, and a maximum amount of collateral is offered in exchange. The collateral may or may not be fully expended, and the requested `baseToken` may or may not be obtained.

### CollateralDebtPayer.sol

This helper contract is used to pay a loan using collateral, it borrows collateral off a given entry and uses the tokens to pay a loan, those tokens may have to be converted to `baseToken`, the conversion is handled by a provided `TokenConverter` contract.

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

### Cosigningment

For a collateral entry to be used with a loan the lender of the loan has to request the consignment of `Collateral.sol` during the `lend()` process, previous of the consignment the collateral is not tied to the loan and the owner can withdraw it at any time.

The consignment can't be performed by calling directly to `requestCosign()`, such call it's only acceptable if it comes through the `LoanManager` contract. A lender that intents to lend a loan with collateral attached to it should pass the address of `Collateral.sol` (`_cosigner`) and a bytes array containing the collateral ID (`_cosignerData`), during the `lend()` call.

The passed collateral ID specifies which collateral entry is going to be used as collateral for the loan.

The consignment requires that the `collateral/debt` ratio to be above the defined `_liquidationRatio`, and this is intended to impede the owner of the collateral to front-run the `lend` transaction with a `withdraw` transaction.

### Deposit

A user may need to increase the collateralization ratio to avoid a liquidation event; this can be done by paying part of the debt, or by depositing aditional collateral into the entry. Any address can perform both processes without needing the authorization of the owner of the entry.

A deposit increases the total amount of collateral of the entry, hence increasing its debt ratio, without creating a new one or changing any other explicit properties.

The deposit of aditional collateral can be made at any time, even after the debt is paid or before it's cosigned, the only scenario on which deposit isn't allowed is during a liquidation auction, in which case any deposit transaction reverts.

### Withdraw

A user may decide to withdraw some collateral if the entry is above `liquidationRatio` with enough margin or if it wants to cancel the collateral entry before the consignment.

If the collateral hasn't cosigned a loan, the owner can withdraw the complete balance of the entry. Still, if the entry is already attached to a loan, the owner it's allowed to withdraw up to reaching the `liquidationRatio`, aditional withdraw calls would revert. 

Only the owner of the entry and his authorized addresses are allowed to withdraw collateral; the withdrawment of collateral decreases the total amount of collateral of an entry, decreasing its debt ratio.

Withdrawal of collateral can be performed at any time; if the loan is ongoing the maximum amount to withdraw is determined by its `liquidationRatio`. Still, at any other time, the total of the collateral can be withdrawn, the only scenario on which withdrawals aren't allowed is during a liquidation auction, in which case the withdrawal transaction reverts.

### Liquidation

When collateral get's liquidated, part or all the collateral is used to pay part or all the debt; the liquidation mechanism is a dutch auction, which also determines the real collateralization ratio of the entry.

Liquidations are triggered by calling the method `claim()`; the method validates the liquidation conditions and proceeds to create an auction if those conditions are met. The method is expected to be called by the `lender`, but any address can trigger the liquidation.

#### Overdue liquidation

A collateral liquidation can be triggered if the borrower of the attached loan incurs into overdue debt, a loan is considered overdue when the current block timestamp exceeds the `getDueTime` defined by the loan model, without a grace period.

When such liquidation is triggered, the system creates an auction intending the payment of the obligation up to the `dueTime`, value that is provided by the method `getObligation` of the loan model; an aditional 5% of base tokens (RCN) are requested to account for oracle rate changes and accrued interest.

#### Ratio liquidation

A collateral liquidation can be triggered if the current collateral ratio passes below the defined `liquidationRatio`.

During the liquidation, the system creates an auction requesting enough base tokens to pay the debt and move the collateral ratio up to the defined `balanceRatio`. It's unlikely that when the auction gets closed, the resulting collateral ratio becomes exactly `balanceRatio`. However, it shouldn't pose an issue because the real goal of the liquidation is to move the ratio above `liquidationRatio`.

#### Priority

Only one auction per collateral entry can exist at the same time, in the case of both liquidation conditions being met at the same time, the `overdue` liquidation has priority.

### Dutch auction

A Dutch auction is a mechanism used to convert from collateral tokens to base token; each liquidation triggers a unique auction. When the auction is completed, the accrued base tokens are used to pay the debt associated with the collateral, and any extra is sent to the collateral owner's address.

#### First stage

When the auction is created, an initial exchange rate of `market - 5%` is defined, `market` being provided by the oracle of the entry. The exchange rate it's increased to match the market second by second, and after 10 minutes, the exchange rate equals the one provided by the oracle.

The exchange rate is manipulated by offering more collateral for the same requested amount of base until a buyer is found or the auction runs out of collateral (all collateral is offered on the auction).

#### Second stage

The second stage is only reached when the loan is considered under-collateralized, in which case the total amount of collateral is offered in exchange on an ever decreasing amount of base tokens. This asked amount starts on the requested by the liquidation trigger and linearly goes down to zero in 24 hours.

In case of not finding a buyer during the second stage, such a second stage, it's repeated.

#### Taking the auction

Any address can take an ongoing auction, as long as the address can provide the requested base tokens (RCN). During the taking process, the collateral is first transferred to the taker, an optional callback to the taker address can be requested to perform arbitrage, and finally, the base tokens are transferred from the taker address.

The taker is also requested to provide a valid `oracleData` if the loan oracle requires it, and also enogh gas to perform the payment of the loans.

### Collateral borrowing

The owner of the collateral entry can withdraw all collateral at any time,  the sole condition being that after the end of the transaction, the collateral ratio of the loan must be above or equal to the ratio at the beginning of the transaction.

This mechanism is intended to allow a borrower to re-pay a loan using his locked collateral; this is performed using the `CollateralDebtpayer.sol` contract, which uses a part of the collateral tokens, sells it to a token converter, and uses it to pay the debt totally or partially.
