// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVaultRedeem {
    function redeem(address user, address token, uint256 amount, uint256 redeemId) external;
}

contract ReentrantToken is ERC20 {
    address public vault;
    bool private attacking;

    constructor() ERC20("Reentrant", "RE") {}

    function setVault(address v) external { vault = v; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (vault != address(0) && from == vault && !attacking) {
            attacking = true;
            // attempt to re-enter with a different redeemId during the transfer-out
            IVaultRedeem(vault).redeem(to, address(this), value, 999_999);
            attacking = false;
        }
    }
}
