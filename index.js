const fs = require('fs');
const ethers = require('ethers');
const chalk = require('chalk');

// Load private keys from file
const privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
  .split('\n')
  .map(key => key.trim())
  .filter(Boolean);

// Load the target address
const targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

// Connect to MEGA Testnet
const provider = new ethers.providers.JsonRpcProvider('https://carrot.megaeth.com/rpc');

// Set gas limit
const gasLimit = 21000;

(async () => {
  console.log(chalk.cyan('\n🚀 MegaETH Multi-Wallet Sender Started...\n'));

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];

    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      const balance = await provider.getBalance(wallet.address);

      if (balance.eq(0)) {
        console.log(chalk.yellow(`⚠️  Wallet ${wallet.address} has 0 ETH. Skipping...`));
        continue;
      }

      const gasPrice = await provider.getGasPrice();
      const totalFee = gasPrice.mul(gasLimit);

      if (balance.lte(totalFee)) {
        console.log(chalk.red(`❌ Wallet ${wallet.address} doesn't have enough ETH for gas.`));
        continue;
      }

      const amountToSend = balance.sub(totalFee);

      const tx = await wallet.sendTransaction({
        to: targetAddress,
        value: amountToSend,
        gasLimit,
        gasPrice
      });

      console.log(chalk.green(`✅ Sent ${ethers.utils.formatEther(amountToSend)} MEGA from ${wallet.address}`));
      console.log(chalk.gray(`🔗 Tx Hash: ${tx.hash}`));

    } catch (err) {
      console.log(chalk.red(`❌ Error in wallet ${i + 1}: ${err.message}`));
    }
  }

  console.log(chalk.blue('\n✅ All wallets processed. MegaETH sending complete.\n'));
})();
