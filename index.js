import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import cliProgress from 'cli-progress';

// ====== Configuration ======
const config = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002',
  gasBuffer: 1.2,
  refreshInterval: 15000
};

// ====== Global State ======
let provider;
let privateKeys = [];
let targetAddress = '';
let screen, grid, logBox, donut, line, table;
let ethFlowData = { x: [], y: [] };
let success = 0, failed = 0, skipped = 0;
let progressBar;
let isShuttingDown = false;

// ====== Load Keys & Target ======
function loadFiles() {
  console.log(chalk.blue('Step 1: Loading files...'));
  try {
    if (!fs.existsSync('private_keys.txt')) {
      throw new Error('private_keys.txt not found');
    }
    if (!fs.existsSync('target_address.txt')) {
      throw new Error('target_address.txt not found');
    }
    
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.length === 64 || line.length === 66));
    
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length) throw new Error('No valid private keys found in private_keys.txt');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address in target_address.txt');
    
    console.log(chalk.green(`Successfully loaded ${privateKeys.length} keys and target address: ${targetAddress}`));
    return true;
  } catch (err) {
    console.error(chalk.red('❌ File loading failed:'), err.message);
    return false;
  }
}

// ====== Terminal UI Setup ======
function initUI() {
  console.log(chalk.blue('Step 2: Initializing UI...'));
  if (!process.stdout.isTTY) {
    console.error(chalk.red('Error: Interactive terminal required (no TTY detected)'));
    return false;
  }

  try {
    screen = blessed.screen({
      smartCSR: true,
      dockBorders: true,
      fullUnicode: true,
      input: process.stdin,
      output: process.stdout,
      terminal: process.env.TERM || 'xterm-256color',
      title: 'MegaETH Dashboard'
    });

    console.log(chalk.blue('Creating grid...'));
    grid = new contrib.grid({ rows: 12, cols: 12, screen });

    console.log(chalk.blue('Setting up donut...'));
    donut = grid.set(0, 0, 4, 4, contrib.donut, {
      label: ' Status ',
      radius: 16,
      arcWidth: 8,
      data: [
        { label: 'Success', percent: 0, color: 'green' },
        { label: 'Failed', percent: 0, color: 'red' },
        { label: 'Skipped', percent: 0, color: 'yellow' }
      ]
    });

    console.log(chalk.blue('Setting up line graph...'));
    line = grid.set(0, 4, 4, 8, contrib.line, {
      label: ' ETH Flow ',
      showLegend: true,
      legend: { width: 12 }
    });

    console.log(chalk.blue('Setting up table...'));
    table = grid.set(4, 0, 4, 12, contrib.table, {
      label: ' Wallet Balances ',
      columnWidth: [25, 15, 12, 18, 14],
      columnSpacing: 2,
      interactive: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      columns: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time']
    });

    console.log(chalk.blue('Setting up log box...'));
    logBox = grid.set(8, 0, 4, 12, blessed.log, {
      label: ' Live Logs ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: 'cyan' }},
      scrollable: true,
      scrollbar: { bg: 'blue' },
      tags: true
    });

    console.log(chalk.blue('Binding keys...'));
    screen.key(['q', 'C-c', 'escape'], () => {
      if (!isShuttingDown) gracefulShutdown();
    });

    screen.on('render', () => console.log(chalk.green('Screen rendered successfully')));
    screen.on('error', (err) => console.error(chalk.red('Screen error:'), err));
    console.log(chalk.blue('Rendering initial screen...'));
    screen.render();
    console.log(chalk.green('UI initialized successfully'));
    return true;
  } catch (err) {
    console.error(chalk.red('UI initialization failed:'), err.message);
    return false;
  }
}

// ====== Dashboard Refresh ======
function updateDashboard() {
  if (!screen) {
    console.log(chalk.yellow('No screen available for update'));
    return;
  }

  console.log(chalk.blue('Updating dashboard...'));
  donut.setData([
    { label: 'Success', percent: (success / privateKeys.length) * 100 || 0, color: 'green' },
    { label: 'Failed', percent: (failed / privateKeys.length) * 100 || 0, color: 'red' },
    { label: 'Skipped', percent: (skipped / privateKeys.length) * 100 || 0, color: 'yellow' }
  ]);

  line.setData([{
    title: 'ETH Sent',
    x: ethFlowData.x,
    y: ethFlowData.y,
    style: { line: 'green' }
  }]);

  screen.render();
}

// ====== Shutdown Handler ======
function gracefulShutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(chalk.blue('Initiating shutdown with code:', code));
  try {
    if (progressBar) {
      progressBar.stop();
      console.log(chalk.blue('Progress bar stopped'));
    }
    if (screen) {
      screen.program.clear();
      screen.program.disableMouse();
      screen.program.showCursor();
      screen.program.normalBuffer();
      screen.destroy();
      console.log(chalk.green('Screen destroyed'));
    }
    process.stdout.write('\n');
  } catch (e) {
    console.error('Shutdown error:', e.message);
  } finally {
    console.log(chalk.green('Process exiting with code:', code));
    process.exit(code);
  }
}

// ====== Process One Wallet ======
async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();
  const spinner = ora(`Processing ${address}`).start();
  const now = new Date().toLocaleString();

  try {
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(config.minBalance);

    if (balance < minBalanceWei) {
      skipped++;
      logBox.log(`{yellow-fg}⚠ ${address} - Low balance (${balanceEth} ETH){/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, balanceEth, 'Skipped', '-', now]]
      });
      spinner.warn('Skipped');
      return;
    }

    const feeData = await provider.getFeeData();
    const gasLimit = 21000n;
    const gasCost = (gasLimit * (feeData.maxFeePerGas || feeData.gasPrice)) * BigInt(Math.floor(config.gasBuffer * 100)) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`{yellow-fg}⚠ ${address} - Insufficient after gas{/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, balanceEth, 'Skipped', '-', now]]
      });
      spinner.warn('Too low after gas');
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });

    const receipt = await tx.wait();
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      success++;
      ethFlowData.x.push(index.toString());
      ethFlowData.y.push(Number(amountEth));
      logBox.log(`{green-fg}✔ ${now} | ${amountEth} ETH | ${tx.hash}{/}`);
      table.setData({
        headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
        data: [...(table.rows || []), [address, amountEth, 'Success', tx.hash.slice(0, 12) + '...', now]]
      });
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    failed++;
    logBox.log(`{red-fg}✖ ${now} | Error: ${err.message}{/}`);
    table.setData({
      headers: ['Address', 'Balance', 'Status', 'Tx Hash', 'Time'],
      data: [...(table.rows || []), [address, '-', 'Failed', '-', now]]
    });
    spinner.fail(err.message.slice(0, 50));
  } finally {
    updateDashboard();
  }
}

// ====== Main ======
async function main() {
  console.log(chalk.blue('Starting main execution...'));
  if (!loadFiles()) {
    gracefulShutdown(1);
    return;
  }

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  try {
    console.log(chalk.blue('Step 3: Connecting to RPC...'));
    await provider.ready;
    console.log(chalk.green('RPC connected'));
  } catch (err) {
    console.error(chalk.red('RPC connection failed:'), err.message);
    gracefulShutdown(1);
    return;
  }

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Consolidating to ${targetAddress}`));
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  if (!initUI()) {
    gracefulShutdown(1);
    return;
  }

  progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets',
    barCompleteChar: '█',
    barIncompleteChar: '░'
  }, cliProgress.Presets.shades_classic);

  console.log(chalk.blue('Step 4: Starting wallet processing...'));
  progressBar.start(privateKeys.length, 0);

  try {
    for (let i = 0; i < privateKeys.length; i++) {
      console.log(chalk.blue(`Processing wallet ${i + 1}/${privateKeys.length}`));
      await processWallet(privateKeys[i], i);
      progressBar.update(i + 1);
    }

    progressBar.stop();
    logBox.log('{green-fg}\n✨ All transactions completed!{/}');
    logBox.log('{yellow-fg}Press q, Ctrl+C, or Esc to exit{/}');
  } catch (err) {
    console.error(chalk.red('Processing error:'), err.message);
    gracefulShutdown(1);
  }
}

// ====== Global Error Handling ======
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  if (!isShuttingDown) gracefulShutdown(1);
});

process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
  if (!isShuttingDown) gracefulShutdown(1);
});

process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));

// ====== Start ======
console.log(chalk.blue('Script starting...'));
main();
