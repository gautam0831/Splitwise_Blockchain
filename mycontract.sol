// SPDX-License-Identifier: UNLICENSED

// DO NOT MODIFY BELOW THIS
pragma solidity ^0.8.17;

import "hardhat/console.sol";

contract Splitwise {
// DO NOT MODIFY ABOVE THIS
// ADD YOUR CONTRACT CODE BELOW
  mapping (address => mapping(address => uint32)) private owes; 
  mapping(address => bool) private knownUsers;
  address[] private users;

  function addUser(address userAddress) private returns(bool addedUser) {
    if (!knownUsers[userAddress]) {
      knownUsers[userAddress] = true;
      users.push(userAddress);
    }
    return true;
  }

  function lookupAllDebt(address debtor) external view returns(uint32 debt) {
    if (!knownUsers[debtor]) return 0;
    uint32 amount = 0;
    for (uint i=0; i<users.length; i++) {
      address creditor_i = users[i];
      amount += owes[debtor][creditor_i];
    }
    return amount;
  }

  function lookup(address debtor, address creditor) external view returns(uint32 debt) {
    return owes[debtor][creditor];
  }

  function checkAndRemoveCycle(address[] memory debtCycle, uint32 minAmount) external returns (bool cycleRemoved) {
    require(minAmount > 0, "Value must be greater than 0.");
    require(debtCycle[0] == debtCycle[debtCycle.length-1], "Debt must be in a cycle.");
    for (uint i=0; i<debtCycle.length-1; i++) {
      address debtor = debtCycle[i];
      address creditor = debtCycle[i+1];
      if(owes[debtor][creditor] < minAmount) {
        revert("minAmount not met for all creditors");
      }
      owes[debtor][creditor] -= minAmount;      
    }
    return true;
  }

  function add_IOU(address creditor, uint32 amount) external returns(bool addedIOU) {
    address debtor = msg.sender;
    require(amount > 0, "Value must be greater than 0.");
    require(debtor != creditor, "Can not be indebted to yourself");
    // Add Users
    addUser(debtor);
    addUser(creditor);
    // Add IOU
    owes[debtor][creditor] += amount;
    return true;
  }
}
