import os
import time
import csv
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from dotenv import load_dotenv
import threading
import sys
from tqdm import tqdm  # Optional: for progress bars in CLI

# Load environment variables
load_dotenv()

class MegaEthSender:
    def __init__(self, ui_callback):
        self.ui_callback = ui_callback
        self.rpc_endpoints = ['https://carrot.megaeth.com/rpc']
        self.chain_id = 6342
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')
        
        self.w3 = self._connect_to_provider()
        self.target_address = self._load_target_address()
        self.private_keys = self._load_private_keys()

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"Connection failed to {endpoint}: {str(e)}", "warning")
        raise ConnectionError("Could not connect to any RPC endpoint")

    def _load_target_address(self):
        with open('target_address.txt', 'r') as f:
            address = f.read().strip()
        if not Web3.is_address(address):
            raise ValueError("Invalid target address")
        return address

    def _load_private_keys(self):
        keys = []
        with open('private_keys.txt', 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    keys.append(line)
        if not keys:
            raise ValueError("No private keys found")
        return keys

    def transfer_eth(self, private_key):
        account = self.w3.eth.account.from_key(private_key)
        address = account.address
        
        try:
            # Get balance
            balance_wei = self.w3.eth.get_balance(address)
            balance_eth = float(Web3.from_wei(balance_wei, 'ether'))
            
            if balance_eth <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None
            
            # Calculate transfer amount
            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            amount_to_send = max(balance_eth - gas_cost, 0)
            
            if amount_to_send <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Insufficient balance (needs {gas_cost:.6f} ETH for gas)", "warning")
                return None
            
            # Prepare transaction
            tx = {
                'nonce': self.w3.eth.get_transaction_count(address),
                'to': self.target_address,
                'value': Web3.to_wei(amount_to_send, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }
            
            # Send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            # Log transaction
            with open('transactions.csv', 'a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([address, balance_eth, amount_to_send, tx_hash.hex()])
            
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Sent {amount_to_send:.6f} ETH", "success")
            return tx_hash.hex()
        
        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{address},{str(e)}\n")
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Error: {str(e)}", "error")
            return None

class MegaEthSenderCLI:
    def __init__(self):
        self.sender = MegaEthSender(self.update_console)
        self.total_wallets = len(self.sender.private_keys)
        self.processed = 0
        self.successful = 0
        self.failed = 0
        self.eth_sent = 0.0

    def update_console(self, message, msg_type="info"):
        timestamp = time.strftime("%H:%M:%S")
        prefix = f"[{timestamp}] [{msg_type.upper()}] "
        print(f"{prefix}{message}")

    def run(self):
        print("=== MEGA ETH Sender Pro ===")
        print(f"Target Address: {self.sender.target_address[:12]}...{self.sender.target_address[-6:]}")
        print(f"Network: MEGA Testnet (Chain ID: {self.sender.chain_id})")
        print(f"Total Wallets: {self.total_wallets}")
        print("==========================\n")

        # Initialize CSV
        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])

        # Process wallets with ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Optional: Use tqdm for a progress bar
            results = list(tqdm(executor.map(self.sender.transfer_eth, self.sender.private_keys), 
                                total=self.total_wallets, 
                                desc="Processing Wallets"))

        # Update stats
        self.successful = sum(1 for result in results if result is not None)
        self.failed = self.total_wallets - self.successful

        # Final report
        print("\n=== Transaction Summary ===")
        print(f"Total Wallets: {self.total_wallets}")
        print(f"Successful: {self.successful}")
        print(f"Failed: {self.failed}")
        print("==========================")

if __name__ == "__main__":
    app = MegaEthSenderCLI()
    app.run()
