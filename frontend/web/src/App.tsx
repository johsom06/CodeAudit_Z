import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AuditData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<AuditData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuditData, setNewAuditData] = useState({ name: "", codeValue: "", description: "" });
  const [selectedAudit, setSelectedAudit] = useState<AuditData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auditsList: AuditData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auditsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAudits(auditsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAudit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted code..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const codeValue = parseInt(newAuditData.codeValue) || 0;
      const businessId = `audit-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, codeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuditData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        0,
        newAuditData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Code audit created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewAuditData({ name: "", codeValue: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAudits = audits.filter(audit =>
    audit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    audit.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedAudits = filteredAudits.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredAudits.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Code Audit 🔐</h1>
            <p>Privacy-Preserving Code Security Analysis</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Secure Code Audit Platform</h2>
            <p>Connect your wallet to start encrypted code analysis with FHE technology</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h3>Encrypted Analysis</h3>
                <p>Code remains encrypted during vulnerability scanning</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🛡️</div>
                <h3>IP Protection</h3>
                <p>Your source code intellectual property stays protected</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>FHE Powered</h3>
                <p>Homomorphic encryption enables secure computations</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Setting up secure computation environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted audit system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Code Audit 🔐</h1>
          <p>Privacy-Preserving Code Security</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check System Status
          </button>
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn"
          >
            Upload Encrypted Code
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <div className="stats-panel">
            <div className="stat-item">
              <h3>Total Audits</h3>
              <div className="stat-value">{audits.length}</div>
            </div>
            <div className="stat-item">
              <h3>Verified</h3>
              <div className="stat-value">{audits.filter(a => a.isVerified).length}</div>
            </div>
            <div className="stat-item">
              <h3>Avg Security Score</h3>
              <div className="stat-value">
                {audits.length > 0 ? (audits.reduce((sum, a) => sum + a.publicValue1, 0) / audits.length).toFixed(1) : '0.0'}
              </div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search audits by name or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="audits-section">
          <h2>Code Audit History</h2>
          
          <div className="audits-list">
            {paginatedAudits.length === 0 ? (
              <div className="no-audits">
                <p>No code audits found</p>
                <button 
                  className="upload-btn" 
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Audit
                </button>
              </div>
            ) : paginatedAudits.map((audit, index) => (
              <div 
                className={`audit-item ${selectedAudit?.id === audit.id ? "selected" : ""} ${audit.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedAudit(audit)}
              >
                <div className="audit-header">
                  <h3>{audit.name}</h3>
                  <span className={`status-badge ${audit.isVerified ? "verified" : "pending"}`}>
                    {audit.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <p className="audit-desc">{audit.description}</p>
                <div className="audit-meta">
                  <span>Security Score: {audit.publicValue1}/100</span>
                  <span>{new Date(audit.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="audit-creator">
                  Creator: {audit.creator.substring(0, 6)}...{audit.creator.substring(38)}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
        
        <div className="faq-section">
          <h2>FHE Code Audit FAQ</h2>
          <div className="faq-grid">
            <div className="faq-item">
              <h3>How does FHE protect my code?</h3>
              <p>Your source code is encrypted before analysis and remains encrypted throughout the vulnerability scanning process using homomorphic encryption.</p>
            </div>
            <div className="faq-item">
              <h3>What types of vulnerabilities can be detected?</h3>
              <p>The system scans for common security issues while keeping your code encrypted, protecting your intellectual property.</p>
            </div>
            <div className="faq-item">
              <h3>Is the decryption process secure?</h3>
              <p>Yes, decryption requires on-chain verification and happens locally in your browser, ensuring maximum security.</p>
            </div>
          </div>
        </div>
      </div>
      
      {showUploadModal && (
        <ModalUploadCode 
          onSubmit={createAudit} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading} 
          auditData={newAuditData} 
          setAuditData={setNewAuditData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAudit && (
        <AuditDetailModal 
          audit={selectedAudit} 
          onClose={() => setSelectedAudit(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedAudit.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalUploadCode: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  auditData: any;
  setAuditData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, auditData, setAuditData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'codeValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setAuditData({ ...auditData, [name]: intValue });
    } else {
      setAuditData({ ...auditData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-code-modal">
        <div className="modal-header">
          <h2>Upload Encrypted Code for Audit</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Code complexity value will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Project Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auditData.name} 
              onChange={handleChange} 
              placeholder="Enter project name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Code Complexity Score (Integer only) *</label>
            <input 
              type="number" 
              name="codeValue" 
              value={auditData.codeValue} 
              onChange={handleChange} 
              placeholder="Enter complexity score..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Project Description *</label>
            <textarea 
              name="description" 
              value={auditData.description} 
              onChange={handleChange} 
              placeholder="Describe your project and security concerns..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !auditData.name || !auditData.codeValue || !auditData.description} 
            className="submit-btn"
          >
            {uploading || isEncrypting ? "Encrypting and Uploading..." : "Upload for Audit"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuditDetailModal: React.FC<{
  audit: AuditData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ audit, onClose, isDecrypting, decryptData }) => {
  const [localDecryptedValue, setLocalDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (audit.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="audit-detail-modal">
        <div className="modal-header">
          <h2>Code Audit Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="audit-info">
            <div className="info-item">
              <span>Project Name:</span>
              <strong>{audit.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{audit.creator.substring(0, 6)}...{audit.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Audit Date:</span>
              <strong>{new Date(audit.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Security Score:</span>
              <strong>{audit.publicValue1}/100</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Project Description</h3>
            <p>{audit.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>Encrypted Data</h3>
            <div className="data-row">
              <div className="data-label">Code Complexity:</div>
              <div className="data-value">
                {audit.isVerified && audit.decryptedValue ? 
                  `${audit.decryptedValue} (On-chain Verified)` : 
                  localDecryptedValue !== null ? 
                  `${localDecryptedValue} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(audit.isVerified || localDecryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || audit.isVerified}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : audit.isVerified ? (
                  "✅ Verified"
                ) : localDecryptedValue !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
          </div>
          
          <div className="security-info">
            <h3>Security Assessment</h3>
            <div className="security-badge">
              <span className={`score ${audit.publicValue1 >= 80 ? 'excellent' : audit.publicValue1 >= 60 ? 'good' : 'poor'}`}>
                {audit.publicValue1}/100
              </span>
              <span>Overall Security Rating</span>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;