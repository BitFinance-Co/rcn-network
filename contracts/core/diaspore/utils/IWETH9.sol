pragma solidity ^0.5.8;

import "../../../interfaces/IERC20.sol";


contract IWETH9 is IERC20 {
    function deposit() public payable;
    function withdraw(uint wad) public;
}
