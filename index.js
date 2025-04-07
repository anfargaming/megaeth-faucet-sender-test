import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { createRoot } from 'react-dom/client';

const ETHConsolidatorDashboard = () => {
  const [state, setState] = useState({
    rpcEndpoints: [
      'https://carrot.megaeth.com/rpc',
      'https://rpc.testnet.megaeth.com',
      'https://testnet.megaeth.io/rpc'
    ],
    currentEndpoint: '',
    chainId: 6342,
    maxFeePerGas: ethers.parseUnits('0.0025', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('0.001', 'gwei'),
    targetAddress: localStorage.getItem('targetAddress') || '',
    privateKeys: JSON.parse(localStorage.getItem('privateKeys')) || [],
    transactions: [],
    status: 'idle',
    progress: {
      current: 0,
      total: JSON.parse(localStorage.getItem('privateKeys'))?.length || 0,
      successful: 0,
      failed: 0
    },
    error: null
  });

  // Connect to provider on mount
  useEffect(() => {
    const connectToProvider = async () => {
      for (const endpoint of state.rpcEndpoints) {
        try {
          const provider = new ethers.JsonRpcProvider(endpoint);
          const network = await provider.getNetwork();
          if (network.chainId === state.chainId) {
            setState(prev => ({ ...prev, currentEndpoint: endpoint, provider }));
            return provider;
          }
        } catch (e) {
          console.error(`Connection failed to ${endpoint}:`, e);
        }
      }
      setState(prev => ({ ...prev, error: 'Could not connect to any RPC endpoint' }));
      return null;
    };

    connectToProvider();
  }, []);

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      if (type === 'targetAddress') {
        const address = content.trim();
        if (ethers.isAddress(address)) {
          localStorage.setItem('targetAddress', address);
          setState(prev => ({ ...prev, targetAddress: address }));
        } else {
          setState(prev => ({ ...prev, error: 'Invalid Ethereum address' }));
        }
      } else if (type === 'privateKeys') {
        const keys = content.split('\n').map(line => line.trim()).filter(line => line);
        localStorage.setItem('privateKeys', JSON.stringify(keys));
        setState(prev => ({
          ...prev,
          privateKeys: keys,
          progress: { ...prev.progress, total: keys.length }
        }));
      }
    };
    reader.readAsText(file);
  };

  const getBalance = async (address, retries = 3) => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const balance = await state.provider.getBalance(address);
        return parseFloat(ethers.formatEther(balance));
      } catch (e) {
        if (attempt === retries - 1) throw e;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  };

  const transferETH = async (privateKey, index) => {
    const wallet = new ethers.Wallet(privateKey, state.provider);
    const address = wallet.address;
    
    setState(prev => ({
      ...prev,
      status: 'processing',
      progress: { ...prev.progress, current: index + 1 }
    }));

    try {
      const balanceETH = await getBalance(address);
      if (balanceETH <= 0) return null;
      
      const amountToSend = Math.max(balanceETH - 0.001, 0);
      if (amountToSend <= 0) return null;

      const tx = {
        to: state.targetAddress,
        value: ethers.parseEther(amountToSend.toString()),
        maxFeePerGas: state.maxFeePerGas,
        maxPriorityFeePerGas: state.maxPriorityFeePerGas,
        chainId: state.chainId,
        type: 2
      };

      tx.gasLimit = await state.provider.estimateGas(tx);
      const txResponse = await wallet.sendTransaction(tx);

      const newTx = {
        hash: txResponse.hash,
        from: address,
        to: state.targetAddress,
        amount: amountToSend,
        status: 'pending',
        explorerUrl: `https://megaexplorer.xyz/tx/${txResponse.hash}`
      };

      setState(prev => ({
        ...prev,
        transactions: [...prev.transactions, newTx]
      }));

      await txResponse.wait();
      
      setState(prev => ({
        ...prev,
        transactions: prev.transactions.map(tx => 
          tx.hash === txResponse.hash ? { ...tx, status: 'confirmed' } : tx
        ),
        progress: {
          ...prev.progress,
          successful: prev.progress.successful + 1
        }
      }));

      return txResponse.hash;
    } catch (e) {
      console.error(`Error with ${address}:`, e);
      setState(prev => ({
        ...prev,
        progress: {
          ...prev.progress,
          failed: prev.progress.failed + 1
        },
        error: e.message
      }));
      return null;
    } finally {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };

  const runConsolidation = async () => {
    if (!state.targetAddress || state.privateKeys.length === 0) {
      setState(prev => ({ ...prev, error: 'Missing target address or private keys' }));
      return;
    }

    setState(prev => ({
      ...prev,
      status: 'loading',
      transactions: [],
      progress: {
        current: 0,
        total: prev.privateKeys.length,
        successful: 0,
        failed: 0
      }
    }));

    for (let i = 0; i < state.privateKeys.length; i++) {
      await transferETH(state.privateKeys[i], i);
    }

    setState(prev => ({ ...prev, status: 'completed' }));
  };

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <header style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ color: '#2c3e50' }}>MEGA Testnet ETH Consolidator</h1>
        <p>Network Chain ID: {state.chainId}</p>
        {state.currentEndpoint && (
          <p style={{
            padding: '5px 10px',
            borderRadius: '4px',
            display: 'inline-block',
            backgroundColor: '#d4edda',
            color: '#155724'
          }}>
            Connected to: {state.currentEndpoint}
          </p>
        )}
      </header>
      
      <div style={{
        backgroundColor: '#f8f9fa',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h2>Configuration</h2>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Target Address:
          </label>
          <input
            type="text"
            value={state.targetAddress}
            onChange={(e) => setState(prev => ({ ...prev, targetAddress: e.target.value }))}
            placeholder="0x..."
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ced4da',
              borderRadius: '4px',
              boxSizing: 'border-box'
            }}
          />
          <input
            type="file"
            id="targetAddressFile"
            onChange={(e) => handleFileUpload(e, 'targetAddress')}
            accept=".txt"
            style={{ display: 'none' }}
          />
          <label htmlFor="targetAddressFile" style={{
            display: 'inline-block',
            backgroundColor: '#e9ecef',
            padding: '5px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '5px'
          }}>
            Upload from file
          </label>
        </div>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Private Keys:
          </label>
          <textarea
            value={state.privateKeys.join('\n')}
            onChange={(e) => {
              const keys = e.target.value.split('\n').filter(line => line.trim());
              setState(prev => ({
                ...prev,
                privateKeys: keys,
                progress: { ...prev.progress, total: keys.length }
              }));
            }}
            placeholder="Enter one private key per line"
            rows={5}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ced4da',
              borderRadius: '4px',
              boxSizing: 'border-box'
            }}
          />
          <input
            type="file"
            id="privateKeysFile"
            onChange={(e) => handleFileUpload(e, 'privateKeys')}
            accept=".txt"
            style={{ display: 'none' }}
          />
          <label htmlFor="privateKeysFile" style={{
            display: 'inline-block',
            backgroundColor: '#e9ecef',
            padding: '5px 10px',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '5px'
          }}>
            Upload from file
          </label>
        </div>
        
        <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #dee2e6' }}>
          <h3 style={{ marginTop: '0' }}>Gas Settings</h3>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'inline-block', width: '200px' }}>
              Max Fee Per Gas (gwei):
            </label>
            <input
              type="number"
              step="0.0001"
              value={ethers.formatUnits(state.maxFeePerGas, 'gwei')}
              onChange={(e) => setState(prev => ({
                ...prev,
                maxFeePerGas: ethers.parseUnits(e.target.value, 'gwei')
              }))}
              style={{
                padding: '5px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'inline-block', width: '200px' }}>
              Max Priority Fee Per Gas (gwei):
            </label>
            <input
              type="number"
              step="0.0001"
              value={ethers.formatUnits(state.maxPriorityFeePerGas, 'gwei')}
              onChange={(e) => setState(prev => ({
                ...prev,
                maxPriorityFeePerGas: ethers.parseUnits(e.target.value, 'gwei')
              }))}
              style={{
                padding: '5px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            />
          </div>
        </div>
      </div>
      
      <div style={{ textAlign: 'center', margin: '20px 0' }}>
        <button
          onClick={runConsolidation}
          disabled={state.status === 'processing' || !state.targetAddress || state.privateKeys.length === 0}
          style={{
            backgroundColor: state.status === 'processing' ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          {state.status === 'processing' ? 'Processing...' : 'Start Consolidation'}
        </button>
      </div>
      
      {state.status !== 'idle' && (
        <div style={{ margin: '20px 0', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <h2>Status</h2>
          
          {state.status === 'processing' && (
            <div style={{ marginBottom: '10px' }}>
              <progress
                value={state.progress.current}
                max={state.progress.total}
                style={{ width: '100%', height: '20px' }}
              />
              <p>
                Processing wallet {state.progress.current} of {state.progress.total} • 
                Successful: {state.progress.successful} • 
                Failed: {state.progress.failed}
              </p>
            </div>
          )}
          
          {state.status === 'completed' && (
            <div>
              <p>Consolidation complete!</p>
              <p>Successful transfers: {state.progress.successful}</p>
              <p>Failed transfers: {state.progress.failed}</p>
            </div>
          )}
          
          {state.error && (
            <div style={{
              color: '#721c24',
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              padding: '10px',
              borderRadius: '4px'
            }}>
              <p>Error: {state.error}</p>
            </div>
          )}
        </div>
      )}
      
      {state.transactions.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <h2>Transaction History</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>From</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>To</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Amount (ETH)</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Explorer</th>
              </tr>
            </thead>
            <tbody>
              {state.transactions.map((tx, index) => (
                <tr key={index}>
                  <td style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    {`${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    {`${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    {tx.amount.toFixed(6)}
                  </td>
                  <td style={{ 
                    padding: '12px', 
                    textAlign: 'left', 
                    borderBottom: '1px solid #ddd',
                    color: tx.status === 'confirmed' ? '#155724' : '#856404',
                    backgroundColor: tx.status === 'confirmed' ? '#d4edda' : '#fff3cd'
                  }}>
                    {tx.status}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <a 
                      href={tx.explorerUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: '#007bff', textDecoration: 'none' }}
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Render the app
const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ETHConsolidatorDashboard />
  </React.StrictMode>
);
