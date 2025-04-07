import os
import time
from web3 import Web3
from web3.exceptions import TransactionNotFound
from dotenv import load_dotenv

load_dotenv()

class ETHConsolidator:
    def __init__(self):
        # MEGA Testnet RPC endpoints with fallbacks
        self.rpc_endpoints = [
            'https://carrot.megaeth.com/rpc',  # Primary endpoint
            'https://rpc.testnet.megaeth.com',  # Legacy endpoint
            'https://testnet.megaeth.io/rpc'    # Alternative endpoint
        ]
        self.w3 = self._connect_to_provider()
        self.chain_id = 6342  # Updated MEGA Testnet Chain ID
        
        # EIP-1559 parameters
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')  # Base fee price target
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')  # Base fee price floor
        
        # Load target address
        with open('target_address.txt', 'r') as f:
            self.target_address = f.read().strip()
        
        # Validate target address
        if not self.w3.is_address(self.target_address):
            raise ValueError("Invalid target address in target_address.txt")
        
        # Load private keys
        with open('private_keys.txt', 'r') as f:
            self.private_keys = [line.strip() for line in f if line.strip()]

    def _connect_to_provider(self):
        """Try connecting to different RPC endpoints"""
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    print(f"Connected to {endpoint}")
                    return w3
                else:
                    print(f"Could not connect to {endpoint}")
            except Exception as e:
                print(f"Connection failed to {endpoint}: {str(e)}")
        
        raise ConnectionError("Could not connect to any RPC endpoint")

    def get_balance(self, address):
        """Get balance in ETH with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                balance_wei = self.w3.eth.get_balance(address)
                return self.w3.from_wei(balance_wei, 'ether')
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                print(f"Balance check failed (attempt {attempt + 1}), retrying...")
                time.sleep(2)
                self.w3 = self._connect_to_provider()  # Reconnect

    def transfer_eth(self, private_key):
        """Transfer ETH using EIP-1559 transactions"""
        account = self.w3.eth.account.from_key(private_key)
        address = account.address
        
        print(f"\nProcessing wallet: {address}")
        
        try:
            # Get balance with retry logic
            balance = self.get_balance(address)
            print(f"Current balance: {balance} ETH")
            
            if balance <= 0:
                print("Skipping - zero balance")
                return None
            
            # Calculate amount to send (leave 0.001 ETH for gas)
            amount_to_send = max(balance - 0.001, 0)
            if amount_to_send <= 0:
                print("Skipping - insufficient balance after gas reserve")
                return None
                
            print(f"Preparing to send: {amount_to_send} ETH")
            
            # Get current gas parameters
            gas_limit = 21000
            nonce = self.w3.eth.get_transaction_count(address)
            
            # Build EIP-1559 transaction
            tx = {
                'nonce': nonce,
                'to': self.target_address,
                'value': self.w3.to_wei(amount_to_send, 'ether'),
                'gas': gas_limit,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'  # EIP-1559 transaction type
            }
            
            # Sign and send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            print(f"Transaction sent: {tx_hash.hex()}")
            print(f"Block Explorer: https://megaexplorer.xyz/tx/{tx_hash.hex()}")
            
            # Wait for transaction receipt with longer timeout
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
            print(f"Transaction confirmed in block: {receipt['blockNumber']}")
            
            return tx_hash.hex()
            
        except Exception as e:
            print(f"Error processing transaction: {str(e)}")
            # Attempt to reconnect for next wallet
            self.w3 = self._connect_to_provider()
            return None

    def run(self):
        """Process all wallets with better progress tracking"""
        print(f"\nMEGA Testnet Consolidation Bot")
        print(f"Network Chain ID: {self.chain_id}")
        print(f"Target Address: {self.target_address}")
        print(f"Found {len(self.private_keys)} wallets to process\n")
        
        successful = 0
        failed = 0
        
        for i, private_key in enumerate(self.private_keys, 1):
            try:
                print(f"\n[{i}/{len(self.private_keys)}] Processing wallet...")
                if self.transfer_eth(private_key):
                    successful += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"Fatal error processing wallet: {str(e)}")
                failed += 1
                continue
            finally:
                # Add delay between transactions
                time.sleep(1)  # Respects the 10ms mini-block / 1s EVM block time
        
        print(f"\nConsolidation complete!")
        print(f"Successful transfers: {successful}")
        print(f"Failed transfers: {failed}")

if __name__ == "__main__":
    consolidator = ETHConsolidator()
    consolidator.run()
