pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedCodeAudit is ZamaEthereumConfig {
    struct AuditSession {
        address owner;
        euint32 encryptedCode;
        uint256 publicMetadata;
        bool isVerified;
        uint32 vulnerabilityCount;
        uint256 timestamp;
    }

    mapping(string => AuditSession) public auditSessions;
    string[] public sessionIds;

    event CodeUploaded(string indexed sessionId, address indexed owner);
    event AuditCompleted(string indexed sessionId, uint32 vulnerabilityCount);

    constructor() ZamaEthereumConfig() {}

    function uploadEncryptedCode(
        string calldata sessionId,
        externalEuint32 encryptedCode,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(auditSessions[sessionId].owner == address(0), "Session ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedCode, inputProof)), "Invalid encrypted input");

        euint32 code = FHE.fromExternal(encryptedCode, inputProof);
        FHE.allowThis(code);
        FHE.makePubliclyDecryptable(code);

        auditSessions[sessionId] = AuditSession({
            owner: msg.sender,
            encryptedCode: code,
            publicMetadata: publicMetadata,
            isVerified: false,
            vulnerabilityCount: 0,
            timestamp: block.timestamp
        });

        sessionIds.push(sessionId);
        emit CodeUploaded(sessionId, msg.sender);
    }

    function performAudit(
        string calldata sessionId,
        bytes memory abiEncodedVulnerabilityCount,
        bytes memory auditProof
    ) external {
        AuditSession storage session = auditSessions[sessionId];
        require(session.owner != address(0), "Session does not exist");
        require(!session.isVerified, "Audit already completed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(session.encryptedCode);

        FHE.checkSignatures(cts, abiEncodedVulnerabilityCount, auditProof);

        uint32 decodedCount = abi.decode(abiEncodedVulnerabilityCount, (uint32));
        session.vulnerabilityCount = decodedCount;
        session.isVerified = true;

        emit AuditCompleted(sessionId, decodedCount);
    }

    function getEncryptedCode(string calldata sessionId) external view returns (euint32) {
        require(auditSessions[sessionId].owner != address(0), "Session does not exist");
        return auditSessions[sessionId].encryptedCode;
    }

    function getAuditResults(string calldata sessionId) external view returns (
        address owner,
        uint256 publicMetadata,
        bool isVerified,
        uint32 vulnerabilityCount,
        uint256 timestamp
    ) {
        require(auditSessions[sessionId].owner != address(0), "Session does not exist");
        AuditSession storage session = auditSessions[sessionId];

        return (
            session.owner,
            session.publicMetadata,
            session.isVerified,
            session.vulnerabilityCount,
            session.timestamp
        );
    }

    function getAllSessionIds() external view returns (string[] memory) {
        return sessionIds;
    }

    function serviceStatus() external pure returns (bool operational) {
        return true;
    }
}

