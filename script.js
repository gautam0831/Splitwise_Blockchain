// =============================================================================
//                                  Config
// =============================================================================
const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
var defaultAccount;

var GENESIS = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ============================================================
var abi = [
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "creditor",
				"type": "address"
			},
			{
				"internalType": "uint32",
				"name": "amount",
				"type": "uint32"
			}
		],
		"name": "add_IOU",
		"outputs": [
			{
				"internalType": "bool",
				"name": "addedIOU",
				"type": "bool"
			}
		],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address[]",
				"name": "debtCycle",
				"type": "address[]"
			},
			{
				"internalType": "uint32",
				"name": "minAmount",
				"type": "uint32"
			}
		],
		"name": "checkAndRemoveCycle",
		"outputs": [
			{
				"internalType": "bool",
				"name": "cycleRemoved",
				"type": "bool"
			}
		],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "debtor",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "creditor",
				"type": "address"
			}
		],
		"name": "lookup",
		"outputs": [
			{
				"internalType": "uint32",
				"name": "debt",
				"type": "uint32"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "debtor",
				"type": "address"
			}
		],
		"name": "lookupAllDebt",
		"outputs": [
			{
				"internalType": "uint32",
				"name": "debt",
				"type": "uint32"
			}
		],
		"stateMutability": "view",
		"type": "function"
	}
];
// ============================================================
abiDecoder.addABI(abi);

var contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; 

var BlockchainSplitwise = new ethers.Contract(contractAddress, abi, provider.getSigner());


var OWE = {}

async function updateState() {
	users = await getUsers();
	for (const i in users) {
		OWE[users[i]] = { 'total': 0 };
		for (const j in users) {
			if (i === j) continue
			await BlockchainSplitwise.lookup(users[i], users[j]).then(
				(totalOwed) => {
					OWE[users[i]][users[j]] = totalOwed;
					OWE[users[i]]['total'] += totalOwed;
				}
			);
		}
	}
}


// Return a list of all users (creditors or debtors) in the system
// All users in the system are everyone who has ever sent or received an IOU
async function getUsers() {
	return getAllFunctionCalls(contractAddress, "add_IOU").then(
		(calls) => {
			var users = new Set();
			for (let c of calls) {
				users.add(c.args[0].toLowerCase());
				users.add(c.from.toLowerCase());
			}
			return [...users];
		}
	).catch(() => {
		// On Error return nothing.
		return [];
	});
}

async function removeCycle() {
	return new Promise((bigResolve) => updateState().then(() => {
		function getNeighbors(node) {
			return Object.keys(OWE[node]).filter(neighbor => OWE[node][neighbor] > 0 && neighbor !== "total");
		}
		listOfPromises = [];
		for (const i in OWE) {
			for (const j of getNeighbors(i)) {
				path = doBFS(j, i, getNeighbors);
				if (path !== null) {
					path.unshift(i);
					const minAmount = path.reduce((result, elem, i) =>
						i < path.length - 1 ? Math.min(OWE[elem][path[i + 1]], result) : result
					);
					listOfPromises.push(new Promise((resolve) => BlockchainSplitwise.checkAndRemoveCycle(path, minAmount).then(() => resolve(path)).catch(() => resolve("err"))));
				} else {
					listOfPromises.push(true);
				}
			}
		}
		Promise.all(listOfPromises).then(() => bigResolve());
	}));
}

// Get the total amount owed by the user specified by 'user'
async function getTotalOwed(user) {
	user = user.toLowerCase();
	const amount = await BlockchainSplitwise.lookupAllDebt(user);
	return new Promise(r => r(amount));
}

// Get the last time this user has sent or received an IOU, in seconds since Jan. 1, 1970
// Return null if you can't find any activity for the user.

async function getLastActive(user) {
	user = user.toLowerCase();
	return getAllFunctionCalls(contractAddress, "add_IOU").then(
		(calls) => {
			var lastSeen = 0;
			for (let c of calls) {
				if (c.args[0].toLowerCase() == user || c.from.toLowerCase() == user) {
					lastSeen = Math.max(c.t, lastSeen);
				}
			}
			return lastSeen == 0 ? null : lastSeen;
		}
	).catch(() => {
		// On Error return nothing.
		return null;
	});
}

// add an IOU ('I owe you') to the system
// The person you owe money is passed as 'creditor'
// The amount you owe them is passed as 'amount'
async function add_IOU(creditor, amount) {
	return new Promise(async (resolve) => {
		await BlockchainSplitwise.connect(provider.getSigner(defaultAccount)).add_IOU(creditor, amount).then(() =>
			removeCycle().then(() => resolve())
		);
	})
}

// This searches the block history for all calls to 'functionName' (string) on the 'addressOfContract' (string) contract
// It returns an array of objects, one for each call, containing the sender ('from'), arguments ('args'), and the timestamp ('t')
async function getAllFunctionCalls(addressOfContract, functionName = null) {
	var curBlock = await provider.getBlockNumber();
	var function_calls = [];

	while (curBlock !== GENESIS) {
		var b = await provider.getBlockWithTransactions(curBlock);
		var txns = b.transactions;
		for (var j = 0; j < txns.length; j++) {
			var txn = txns[j];

			// check that destination of txn is our contract
			if (txn.to == null) { continue; }
			if (txn.to.toLowerCase() === addressOfContract.toLowerCase()) {
				var func_call = abiDecoder.decodeMethod(txn.data);

				// check that the function getting called in this txn is 'functionName'
				if (func_call && (func_call.name === functionName || functionName == null)) {
					var timeBlock = await provider.getBlock(curBlock);
					var args = func_call.params.map(function (x) { return x.value });
					function_calls.push({
						from: txn.from.toLowerCase(),
						args: args,
						t: timeBlock.timestamp
					})
				}
			}
		}
		curBlock = b.parentHash;
	}
	return function_calls;
}

// It will find a path from start to end (or return null if none exists)
// You just need to pass in a function ('getNeighbors') that takes a node (string) and returns its neighbors (as an array)
function doBFS(start, end, getNeighbors) {
	var queue = [[start]];
	while (queue.length > 0) {
		var cur = queue.shift();
		var lastNode = cur[cur.length - 1]
		if (lastNode.toLowerCase() === end.toString().toLowerCase()) {
			return cur;
		} else {
			var neighbors = getNeighbors(lastNode);
			for (var i = 0; i < neighbors.length; i++) {
				queue.push(cur.concat([neighbors[i]]));
			}
		}
	}
	return null;
}

// =============================================================================
//                                      UI
// =============================================================================

// This sets the default account on load and displays the total owed to that
// account.
provider.listAccounts().then((response) => {
	defaultAccount = response[0];

	getTotalOwed(defaultAccount).then((response) => {
		$("#total_owed").html("$" + response);
	});

	getLastActive(defaultAccount).then((response) => {
		time = timeConverter(response)
		$("#last_active").html(time)
	});
});

// This code updates the 'My Account' UI with the results of your functions
$("#myaccount").change(function () {
	defaultAccount = $(this).val();

	getTotalOwed(defaultAccount).then((response) => {
		$("#total_owed").html("$" + response);
	})

	getLastActive(defaultAccount).then((response) => {
		time = timeConverter(response)
		$("#last_active").html(time)
	});
});

// Allows switching between accounts in 'My Account' and the 'fast-copy' in 'Address of person you owe
provider.listAccounts().then((response) => {
	var opts = response.map(function (a) {
		return '<option value="' +
			a.toLowerCase() + '">' + a.toLowerCase() + '</option>'
	});
	$(".account").html(opts);
	$(".wallet_addresses").html(response.map(function (a) { return '<li>' + a.toLowerCase() + '</li>' }));
});

// This code updates the 'Users' list in the UI with the results of your function
getUsers().then((response) => {
	$("#all_users").html(response.map(function (u, i) { return "<li>" + u + "</li>" }));
});

// This runs the 'add_IOU' function when you click the button
// It passes the values from the two inputs above
$("#addiou").click(function () {
	defaultAccount = $("#myaccount").val(); //sets the default account
	add_IOU($("#creditor").val(), $("#amount").val()).then((response) => {
		window.location.reload(false); // refreshes the page after add_IOU returns and the promise is unwrapped
	})
});

// This is a log function, provided if you want to display things to the page instead of the JavaScript console
// Pass in a discription of what you're printing, and then the object to print
function log(description, obj) {
	$("#log").html($("#log").html() + description + ": " + JSON.stringify(obj, null, 2) + "\n\n");
}


// =============================================================================
//                                      TESTING
// =============================================================================

// the tests assume that each of the four client functions are
// async functions and thus will return a promise. 

function check(name, condition) {
	if (condition) {
		console.log(name + ": SUCCESS");
		return 3;
	} else {
		console.log(name + ": FAILED");
		return 0;
	}
}

async function sanityCheck() {
	console.log("\nTEST", "Simplest possible test: only runs one add_IOU; uses all client functions: lookup, getTotalOwed, getUsers, getLastActive");

	var score = 0;

	var accounts = await provider.listAccounts();
	defaultAccount = accounts[0];

	var users = await getUsers();
	score += check("getUsers() initially empty", users.length === 0);

	var owed = await getTotalOwed(accounts[1]);
	score += check("getTotalOwed(0) initially empty", owed === 0);

	var lookup_0_1 = await BlockchainSplitwise.lookup(accounts[0], accounts[1]);
	console.log("lookup(0, 1) current value" + lookup_0_1);
	score += check("lookup(0,1) initially 0", parseInt(lookup_0_1, 10) === 0);

	var response = await add_IOU(accounts[1], "10");

	users = await getUsers();
	score += check("getUsers() now length 2", users.length === 2);

	owed = await getTotalOwed(accounts[0]);
	score += check("getTotalOwed(0) now 10", owed === 10);

	lookup_0_1 = await BlockchainSplitwise.lookup(accounts[0], accounts[1]);
	score += check("lookup(0,1) now 10", parseInt(lookup_0_1, 10) === 10);

	var timeLastActive = await getLastActive(accounts[0]);
	var timeNow = Date.now() / 1000;
	var difference = timeNow - timeLastActive;
	score += check("getLastActive(0) works", difference <= 60 && difference >= -3); // -3 to 60 seconds

	console.log("Final Score: " + score + "/21");
}
