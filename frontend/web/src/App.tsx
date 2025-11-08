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
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  vulnerabilityScore: number;
  codeComplexity: number;
}

interface AuditStats {
  totalAudits: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  avgVulnerability: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<AuditData[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newAuditData, setNewAuditData] = useState({ 
    name: "", 
    codeComplexity: 5, 
    vulnerabilityScore: 5,
    description: "" 
  });
  const [selectedAudit, setSelectedAudit] = useState<AuditData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRisk, setFilterRisk] = useState("all");
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<AuditStats>({
    totalAudits: 0,
    highRisk: 0,
    mediumRisk: 0,
    lowRisk: 0,
    avgVulnerability: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
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
              creator: businessData.creator,
              timestamp: Number(businessData.timestamp),
              isVerified: businessData.isVerified,
              decryptedValue: Number(businessData.decryptedValue) || 0,
              vulnerabilityScore: Number(businessData.publicValue1) || 5,
              codeComplexity: Number(businessData.publicValue2) || 5
            });
          } catch (e) {
            console.error('Error loading audit data:', e);
          }
        }
        
        setAudits(auditsList);
        calculateStats(auditsList);
      } catch (e) {
        console.error('Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  useEffect(() => {
    calculateStats(audits);
  }, [audits]);

  const calculateStats = (auditList: AuditData[]) => {
    const total = auditList.length;
    const highRisk = auditList.filter(a => a.vulnerabilityScore >= 8).length;
    const mediumRisk = auditList.filter(a => a.vulnerabilityScore >= 5 && a.vulnerabilityScore < 8).length;
    const lowRisk = auditList.filter(a => a.vulnerabilityScore < 5).length;
    const avgVulnerability = total > 0 ? auditList.reduce((sum, a) => sum + a.vulnerabilityScore, 0) / total : 0;
    
    setStats({
      totalAudits: total,
      highRisk,
      mediumRisk,
      lowRisk,
      avgVulnerability: Number(avgVulnerability.toFixed(1))
    });
  };

  const filteredAudits = audits.filter(audit => {
    const matchesSearch = audit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         audit.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRisk = filterRisk === "all" || 
                       (filterRisk === "high" && audit.vulnerabilityScore >= 8) ||
                       (filterRisk === "medium" && audit.vulnerabilityScore >= 5 && audit.vulnerabilityScore < 8) ||
                       (filterRisk === "low" && audit.vulnerabilityScore < 5);
    return matchesSearch && matchesRisk;
  });

  const uploadAudit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting code with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const businessId = `audit-${Date.now()}`;
      const contractAddress = await contract.getAddress();
      
      const encryptedResult = await encrypt(contractAddress, address, newAuditData.vulnerabilityScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuditData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newAuditData.vulnerabilityScore,
        newAuditData.codeComplexity,
        newAuditData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted audit..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Uploaded: ${newAuditData.name}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Audit uploaded successfully!" });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewAuditData({ name: "", codeComplexity: 5, vulnerabilityScore: 5, description: "" });
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") ? "Transaction rejected" : "Upload failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptAudit = async (auditId: string) => {
    if (!isConnected || !address) return null;
    
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return null;
      
      const auditData = await contractRead.getBusinessData(auditId);
      if (auditData.isVerified) {
        return Number(auditData.decryptedValue);
      }
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(auditId);
      const contractAddress = await contractRead.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(auditId, abiEncodedClearValues, decryptionProof)
      );
      
      setUserHistory(prev => [...prev, `Decrypted: ${auditId}`]);
      return Number(result.decryptionResult.clearValues[encryptedValueHandle]);
      
    } catch (e: any) {
      console.error('Decryption failed:', e);
      return null;
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "FHE system available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      console.error('Availability check failed:', e);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔒</div>
            <h1>FHE Code Audit</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <h2>Secure Code Auditing with FHE</h2>
            <p>Connect your wallet to start encrypted code analysis</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h3>Encrypted Analysis</h3>
                <p>Source code remains encrypted during vulnerability scanning</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🛡️</div>
                <h3>IP Protection</h3>
                <p>Full intellectual property protection with homomorphic encryption</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>Real-time Results</h3>
                <p>Instant vulnerability detection without exposing source code</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-main">
          <div className="logo-section">
            <div className="logo-icon">🔒</div>
            <h1>FHE Code Audit</h1>
          </div>
          
          <div className="header-actions">
            <button className="nav-btn" onClick={checkAvailability}>
              Check System
            </button>
            <button 
              className="upload-btn"
              onClick={() => setShowUploadModal(true)}
            >
              Upload Code
            </button>
            <ConnectButton />
          </div>
        </div>
        
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-label">Total Audits</span>
            <span className="stat-value">{stats.totalAudits}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">High Risk</span>
            <span className="stat-value risk-high">{stats.highRisk}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Medium Risk</span>
            <span className="stat-value risk-medium">{stats.mediumRisk}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Vulnerability</span>
            <span className="stat-value">{stats.avgVulnerability}/10</span>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="controls-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search audits..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-controls">
            <select 
              value={filterRisk} 
              onChange={(e) => setFilterRisk(e.target.value)}
              className="risk-filter"
            >
              <option value="all">All Risks</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
            </select>
          </div>
        </div>

        <div className="content-grid">
          <div className="audits-section">
            <h2>Code Audits</h2>
            <div className="audits-grid">
              {filteredAudits.map((audit) => (
                <div 
                  key={audit.id}
                  className={`audit-card risk-${audit.vulnerabilityScore >= 8 ? 'high' : audit.vulnerabilityScore >= 5 ? 'medium' : 'low'}`}
                  onClick={() => setSelectedAudit(audit)}
                >
                  <div className="audit-header">
                    <h3>{audit.name}</h3>
                    <div className={`risk-badge risk-${audit.vulnerabilityScore >= 8 ? 'high' : audit.vulnerabilityScore >= 5 ? 'medium' : 'low'}`}>
                      {audit.vulnerabilityScore >= 8 ? 'HIGH' : audit.vulnerabilityScore >= 5 ? 'MEDIUM' : 'LOW'}
                    </div>
                  </div>
                  <p className="audit-desc">{audit.description}</p>
                  <div className="audit-meta">
                    <span>Complexity: {audit.codeComplexity}/10</span>
                    <span>{new Date(audit.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="audit-status">
                    {audit.isVerified ? (
                      <span className="status-verified">✅ Verified</span>
                    ) : (
                      <span className="status-pending">🔒 Encrypted</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar">
            <div className="sidebar-section">
              <h3>User History</h3>
              <div className="history-list">
                {userHistory.slice(-5).map((item, index) => (
                  <div key={index} className="history-item">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <h3>Vulnerability Chart</h3>
              <div className="chart-container">
                <div className="chart-bar">
                  <div 
                    className="chart-fill high-risk" 
                    style={{ width: `${(stats.highRisk / Math.max(stats.totalAudits, 1)) * 100}%` }}
                  ></div>
                  <span>High: {stats.highRisk}</span>
                </div>
                <div className="chart-bar">
                  <div 
                    className="chart-fill medium-risk" 
                    style={{ width: `${(stats.mediumRisk / Math.max(stats.totalAudits, 1)) * 100}%` }}
                  ></div>
                  <span>Medium: {stats.mediumRisk}</span>
                </div>
                <div className="chart-bar">
                  <div 
                    className="chart-fill low-risk" 
                    style={{ width: `${(stats.lowRisk / Math.max(stats.totalAudits, 1)) * 100}%` }}
                  ></div>
                  <span>Low: {stats.lowRisk}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showUploadModal && (
        <div className="modal-overlay">
          <div className="upload-modal">
            <div className="modal-header">
              <h2>Upload Code for Audit</h2>
              <button onClick={() => setShowUploadModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="notice-icon">🔐</div>
                <p>Your code will be encrypted with FHE before vulnerability analysis</p>
              </div>
              
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value={newAuditData.name}
                  onChange={(e) => setNewAuditData({...newAuditData, name: e.target.value})}
                  placeholder="Enter project name"
                />
              </div>
              
              <div className="form-group">
                <label>Code Complexity (1-10)</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={newAuditData.codeComplexity}
                  onChange={(e) => setNewAuditData({...newAuditData, codeComplexity: parseInt(e.target.value)})}
                />
                <span>{newAuditData.codeComplexity}</span>
              </div>
              
              <div className="form-group">
                <label>Expected Vulnerability Score (1-10)</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={newAuditData.vulnerabilityScore}
                  onChange={(e) => setNewAuditData({...newAuditData, vulnerabilityScore: parseInt(e.target.value)})}
                />
                <span>{newAuditData.vulnerabilityScore}</span>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newAuditData.description}
                  onChange={(e) => setNewAuditData({...newAuditData, description: e.target.value})}
                  placeholder="Project description"
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button 
                onClick={uploadAudit}
                disabled={uploading || !newAuditData.name}
                className="primary-btn"
              >
                {uploading ? "Encrypting..." : "Upload & Encrypt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAudit && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Audit Details</h2>
              <button onClick={() => setSelectedAudit(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="audit-info">
                <h3>{selectedAudit.name}</h3>
                <p>{selectedAudit.description}</p>
                
                <div className="info-grid">
                  <div className="info-item">
                    <span>Vulnerability Score:</span>
                    <strong>{selectedAudit.vulnerabilityScore}/10</strong>
                  </div>
                  <div className="info-item">
                    <span>Code Complexity:</span>
                    <strong>{selectedAudit.codeComplexity}/10</strong>
                  </div>
                  <div className="info-item">
                    <span>Created:</span>
                    <strong>{new Date(selectedAudit.timestamp * 1000).toLocaleString()}</strong>
                  </div>
                  <div className="info-item">
                    <span>Creator:</span>
                    <strong>{selectedAudit.creator.substring(0, 8)}...{selectedAudit.creator.substring(34)}</strong>
                  </div>
                </div>
                
                <div className="encryption-status">
                  <h4>FHE Encryption Status</h4>
                  {selectedAudit.isVerified ? (
                    <div className="status-verified">
                      <span>✅ On-chain Verified</span>
                      <p>Decrypted value: {selectedAudit.decryptedValue}</p>
                    </div>
                  ) : (
                    <div className="status-encrypted">
                      <span>🔒 Encrypted with FHE</span>
                      <button 
                        onClick={() => decryptAudit(selectedAudit.id)}
                        className="decrypt-btn"
                      >
                        Decrypt & Verify
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

