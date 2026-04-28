# Test ERC-20 Fixture

`test_erc20.bin` is creation bytecode for the ignored anvil smoke test
`submit_erc20_transfer_roundtrip_against_anvil`. It is only used locally to deploy a
minimal ERC-20-like token, submit one `transfer(address,uint256)`, and reconcile the receipt.

Source:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

contract TestToken {
    string public name = "Smoke Token";
    string public symbol = "SMK";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(address holder, uint256 supply) {
        balanceOf[holder] = supply;
        emit Transfer(address(0), holder, supply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
```

Generated with:

```sh
npx -y solc@0.8.19 --bin -o /tmp/test-erc20-out TestToken.sol
```

Compiler/settings: solc-js `0.8.19`, default settings, optimizer disabled.

SHA-256:

```text
3f3e633cb4c2d9b257de91d814a5383fa5b07822cac01b7b8431089e59160f46  test_erc20.bin
```
