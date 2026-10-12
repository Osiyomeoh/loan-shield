// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Morpho Blue's health and share arithmetic, reimplemented so Loan Shield measures a loan
/// exactly the way `Morpho.liquidate` will judge it.
/// @dev Formulas and rounding directions follow Morpho Blue's MathLib, SharesMathLib, ConstantsLib and
/// `Morpho._isHealthy`. Amounts are in loan-token units; health factors and rates are WAD (1e18).
library HealthLib {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 internal constant LIQUIDATION_CURSOR = 0.3e18;
    uint256 internal constant MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15e18;

    function mulDivDown(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return (x * y) / d;
    }

    function mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return (x * y + (d - 1)) / d;
    }

    function wMulDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivDown(x, y, WAD);
    }

    function toSharesDown(uint256 assets, uint256 totalAssets, uint256 totalShares) internal pure returns (uint256) {
        return mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
    }

    function toAssetsUp(uint256 shares, uint256 totalAssets, uint256 totalShares) internal pure returns (uint256) {
        return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
    }

    /// @dev e^(x·n) − 1 to the third Taylor term, as Morpho compounds borrow interest.
    function wTaylorCompounded(uint256 x, uint256 n) internal pure returns (uint256) {
        uint256 firstTerm = x * n;
        uint256 secondTerm = mulDivDown(firstTerm, firstTerm, 2 * WAD);
        uint256 thirdTerm = mulDivDown(secondTerm, firstTerm, 3 * WAD);
        return firstTerm + secondTerm + thirdTerm;
    }

    /// @dev Largest debt the collateral supports before liquidation (`Morpho._isHealthy`).
    function maxBorrow(uint256 collateral, uint256 price, uint256 lltv) internal pure returns (uint256) {
        return wMulDown(mulDivDown(collateral, price, ORACLE_PRICE_SCALE), lltv);
    }

    /// @dev maxBorrow / borrowed in WAD, rounded down. `hf < WAD` exactly when `maxBorrow < borrowed`,
    /// i.e. exactly when Morpho lets the position be liquidated. No debt reads as `type(uint256).max`.
    function healthFactor(uint256 maxBorrow_, uint256 borrowed) internal pure returns (uint256) {
        if (borrowed == 0) return type(uint256).max;
        return mulDivDown(maxBorrow_, WAD, borrowed);
    }

    /// @dev Borrow shares that must be repaid so the remaining debt is at most `maxBorrow_ / targetHf`.
    /// Repaying by shares makes Morpho round the assets up, which never raises the price of the
    /// shares left behind, so the health factor afterwards is at least `targetHf`.
    function sharesToTarget(
        uint256 borrowShares,
        uint256 maxBorrow_,
        uint256 targetHf,
        uint256 totalBorrowAssets,
        uint256 totalBorrowShares
    ) internal pure returns (uint256) {
        uint256 allowedDebt = mulDivDown(maxBorrow_, WAD, targetHf);
        uint256 allowedShares = toSharesDown(allowedDebt, totalBorrowAssets, totalBorrowShares);
        return borrowShares > allowedShares ? borrowShares - allowedShares : 0;
    }

    /// @dev min(1.15, 1 / (1 − 0.3·(1 − lltv))), from `Morpho.liquidate`.
    function liquidationIncentive(uint256 lltv) internal pure returns (uint256) {
        uint256 lif = mulDivDown(WAD, WAD, WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv));
        return lif < MAX_LIQUIDATION_INCENTIVE_FACTOR ? lif : MAX_LIQUIDATION_INCENTIVE_FACTOR;
    }
}
