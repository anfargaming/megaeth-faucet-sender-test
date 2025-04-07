const fs = require('fs');
const { ethers } = require('ethers');
const chalk = require('chalk');

// === CONFIGURATION ===
const RPC_URL = "https://rpc.prior.ethereum.ooga"; // Replace with your faucet/testnet RPC
const AMOUNT_TO_SEND = "0.001"; // ETH to send from each wallet

// === LOAD FILES ===
const privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

const targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

// === CHECKS ===
if (!ethers.isAddress(targetAddress)) {
  console.error(chalk.red(`❌ Invalid target address: ${targetAddress}`));
  process.exit(1);
}

if (privateKeys.length === 0) {
  console.error(chalk.red(`❌ No private keys found in private_keys.txt`));
  process.exit(1);
}

// === START PROVIDER ===
const provider = new ethers.JsonRpcProvider(RPC_URL);

// === SEND FUNCTION ===
async function sendFromWallet(index, privateKey) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);

    console.log(chalk.blue(`\n[${index + 1}] Wallet: ${wallet.address}`));
    console.log(chalk.gray(`Balance: ${ethers.formatEther(balance)} ETH`));

    if (balance < ethers.parseEther(AMOUNT_TO_SEND)) {
      console.log(chalk.yellow(`❌ Insufficient balance. Skipping...`));
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(AMOUNT_TO_SEND),
    });

    console.log(chalk.green(`✅ TX sent: ${tx.hash}`));
    await tx.wait();
    console.log(chalk.green(`🎉 TX confirmed`));
  } catch (err) {
    console.error(chalk.red(`❌ Error with wallet [${index + 1}]: ${err.message}`));
  }
}

// === MULTI SEND START ===
(async () => {
  console.log(chalk.cyan(`🚀 Starting Mega ETH Sender...`));
  console.log(chalk.cyan(`Sending ${AMOUNT_TO_SEND} ETH from ${privateKeys.length} wallets\n`));

  await Promise.all(privateKeys.map((pk, i) => sendFromWallet(i, pk)));

  console.log(chalk.magenta(`\n🎯 All transactions attempted.`));
})();
