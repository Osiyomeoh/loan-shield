// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LoanShield} from "../src/LoanShield.sol";
import {IMorpho, IERC20} from "../src/interfaces/IMorpho.sol";

/// Deploys LoanShield on Arc mainnet. Dry run (no transaction is sent without --broadcast):
///   arc-forge script script/Deploy.s.sol --rpc-url arc
/// Deploy with your own keystore account (`arc-cast wallet import <name> --interactive`):
///   arc-forge script script/Deploy.s.sol --rpc-url arc --account <name> --broadcast
contract Deploy is Script {
    uint256 internal constant ARC_MAINNET = 5042;
    IMorpho internal constant MORPHO = IMorpho(0x34CD04070dD72b14E241112F6d83812Df5Af7fCD);
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function run() external returns (LoanShield shield) {
        require(block.chainid == ARC_MAINNET, "not Arc mainnet");
        require(address(MORPHO).code.length > 0, "Morpho Blue not found");

        vm.startBroadcast();
        shield = new LoanShield(MORPHO, USDC);
        vm.stopBroadcast();

        require(address(shield.MORPHO()) == address(MORPHO) && address(shield.USDC()) == address(USDC));
        console2.log("LoanShield deployed at", address(shield));
    }
}
