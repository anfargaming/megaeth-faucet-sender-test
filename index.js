// mega-eth-sender-terminal.js
const blessed = require('blessed');
const figlet = require('figlet');
const { ethers } = require('ethers');

// Create screen
const screen = blessed.screen({ smartCSR: true, title: 'Mega ETH Sender Pro' });

// Styles
const style = { fg: 'green', bg: 'black', border: { fg: 'cyan' } };

// State
let logs = [];
const walletAddress = '0xYourWalletAddress';
let ethBalance = '...';
let gasPrice = '...';

// Header
const header = blessed.box({
  top: 0,
  height: 5,
  width: '100%',
  tags: true,
  content: '',
  style: { fg: 'magenta', bg: 'black' },
});
screen.append(header);

// Wallet Box
const walletBox = blessed.box({
  top: 5,
  left: 0,
  width: '40%',
  height: 9,
  label: '📒 Wallet Info',
  tags: true,
  border: 'line',
  style,
});
screen.append(walletBox);

// Logs Box
const logBox = blessed.box({
  top: 5,
  left: '40%',
  width: '60%',
  height: '90%-5',
  label: '📜 Transaction Logs',
  tags: true,
  border: 'line',
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'cyan' } },
  style,
});
screen.append(logBox);

// Menu Box
const menuBox = blessed.box({
  bottom: 0,
  height: 4,
  width: '100%',
  tags: true,
  content: '{cyan-fg} [1] Send ETH  |  [2] Check Gas  |  [3] View Logs  |  [q] Quit {/cyan-fg}',
  style: { fg: 'white', bg: 'blue' },
});
screen.append(menuBox);

// Load Header ASCII
function animateHeader() {
  figlet('Mega ETH\nSender Pro', (err, data) => {
    if (!err) {
      header.setContent(`{magenta-fg}${data}{/}`);
      screen.render();
    }
  });
}
animateHeader();

// Update Wallet Info
async function updateWalletInfo() {
  try {
    const provider = new ethers.providers.JsonRpcProvider('https://ethereum.publicnode.com');
    const balance = await provider.getBalance(walletAddress);
    const gas = await provider.getGasPrice();

    ethBalance = ethers.utils.formatEther(balance);
    gasPrice = ethers.utils.formatUnits(gas, 'gwei');

    walletBox.setContent(
      `{bold}Wallet:{/} ${walletAddress.slice(0, 10)}...` +
      `\n{green-fg}ETH Balance:{/} ${ethBalance}` +
      `\n{yellow-fg}Gas Price:{/} ${gasPrice} Gwei`
    );
    screen.render();
  } catch (err) {
    log('[ERROR] Failed to load wallet info');
  }
}
updateWalletInfo();

// Logging
function log(msg) {
  const time = new Date().toLocaleTimeString();
  logs.push(`{gray-fg}[${time}]{/} ${msg}`);
  if (logs.length > 100) logs.shift();
  logBox.setContent(logs.join('\n'));
  logBox.setScrollPerc(100);
  screen.render();
}

// Keybindings
screen.key(['1'], () => {
  log('{green-fg}🚀 Sending ETH transaction...{/}');
  // simulate transaction
  setTimeout(() => log('{green-fg}✅ Transaction confirmed!{/}'), 2000);
});

screen.key(['2'], () => {
  updateWalletInfo();
  log('{cyan-fg}ℹ️ Refreshed gas price and balance{/}');
});

screen.key(['3'], () => {
  log('{yellow-fg}📜 Showing logs...{/}');
});

screen.key(['q', 'C-c'], () => process.exit(0));

// Auto update wallet every 10 sec
setInterval(updateWalletInfo, 10000);

// Initial render
screen.render();
