// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract VerdictProfileNft is Initializable, OwnableUpgradeable, UUPSUpgradeable, ERC721Upgradeable {
    using Strings for uint256;

    struct Profile {
        uint256 tokenId;
        string handle;
        uint256 xp;
        uint256 wins;
        uint256 losses;
        uint256 level;
    }

    uint256 private _nextTokenId;
    string private _baseMetadataUri;

    mapping(address => uint256) private _tokenByOwner;
    mapping(uint256 => Profile) private _profilesByTokenId;
    mapping(bytes32 => bool) public processedMatchIds;
    mapping(address => bool) public rewarders;
    mapping(bytes32 => bool) private _reservedHandles;

    event ProfileMinted(address indexed owner, uint256 indexed tokenId, string handle);
    event MatchResultApplied(
        string indexed matchId,
        address indexed winner,
        address indexed loser,
        uint256 winnerXp,
        uint256 loserPenalty,
        string mode
    );
    event RewarderUpdated(address indexed rewarder, bool allowed);

    modifier onlyRewarder() {
        require(rewarders[msg.sender], "VerdictProfileNft: caller is not an approved rewarder");
        _;
    }

    function initialize(
        address initialOwner,
        string memory name_,
        string memory symbol_,
        string memory baseMetadataUri_
    ) public initializer {
        __ERC721_init(name_, symbol_);
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();

        _nextTokenId = 1;
        _baseMetadataUri = baseMetadataUri_;
    }

    function mintProfile(string calldata handle) external returns (uint256 tokenId) {
        require(_tokenByOwner[msg.sender] == 0, "VerdictProfileNft: profile already exists");

        string memory cleanHandle = _normalizeHandle(handle);
        bytes32 handleHash = keccak256(bytes(cleanHandle));

        require(!_reservedHandles[handleHash], "VerdictProfileNft: handle already taken");

        tokenId = _nextTokenId++;
        _reservedHandles[handleHash] = true;
        _tokenByOwner[msg.sender] = tokenId;

        _profilesByTokenId[tokenId] = Profile({
            tokenId: tokenId,
            handle: cleanHandle,
            xp: 0,
            wins: 0,
            losses: 0,
            level: 1
        });

        _safeMint(msg.sender, tokenId);

        emit ProfileMinted(msg.sender, tokenId, cleanHandle);
    }

    function hasProfile(address owner) external view returns (bool) {
        return _tokenByOwner[owner] != 0;
    }

    function getHandle(address owner) external view returns (string memory) {
        uint256 tokenId = _tokenByOwner[owner];
        require(tokenId != 0, "VerdictProfileNft: profile does not exist");
        return _profilesByTokenId[tokenId].handle;
    }

    function getProfile(address owner) external view returns (Profile memory) {
        uint256 tokenId = _tokenByOwner[owner];
        require(tokenId != 0, "VerdictProfileNft: profile does not exist");
        return _profilesByTokenId[tokenId];
    }

    function tokenOf(address owner) external view returns (uint256) {
        uint256 tokenId = _tokenByOwner[owner];
        require(tokenId != 0, "VerdictProfileNft: profile does not exist");
        return tokenId;
    }

    function applyMatchResult(
        string calldata matchId,
        address winner,
        address loser,
        uint256 winnerXp,
        uint256 loserPenalty,
        string calldata mode
    ) external onlyRewarder {
        bytes32 matchHash = keccak256(bytes(matchId));
        require(!processedMatchIds[matchHash], "VerdictProfileNft: match already processed");

        processedMatchIds[matchHash] = true;

        _applyWinnerReward(winner, winnerXp);
        _applyLoserPenalty(loser, loserPenalty);

        emit MatchResultApplied(matchId, winner, loser, winnerXp, loserPenalty, mode);
    }

    function setRewarder(address rewarder, bool allowed) external onlyOwner {
        rewarders[rewarder] = allowed;
        emit RewarderUpdated(rewarder, allowed);
    }

    function setBaseMetadataUri(string calldata newBaseMetadataUri) external onlyOwner {
        _baseMetadataUri = newBaseMetadataUri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseMetadataUri, tokenId.toString());
    }

    function _applyWinnerReward(address winner, uint256 winnerXp) internal {
        uint256 tokenId = _tokenByOwner[winner];
        require(tokenId != 0, "VerdictProfileNft: winner profile missing");

        Profile storage profile = _profilesByTokenId[tokenId];
        profile.xp += winnerXp;
        profile.wins += 1;
        profile.level = _levelForXp(profile.xp);
    }

    function _applyLoserPenalty(address loser, uint256 loserPenalty) internal {
        uint256 tokenId = _tokenByOwner[loser];
        require(tokenId != 0, "VerdictProfileNft: loser profile missing");

        Profile storage profile = _profilesByTokenId[tokenId];
        profile.losses += 1;

        if (loserPenalty >= profile.xp) {
            profile.xp = 0;
        } else {
            profile.xp -= loserPenalty;
        }

        profile.level = _levelForXp(profile.xp);
    }

    function _normalizeHandle(string memory handle) internal pure returns (string memory) {
        bytes memory raw = bytes(handle);
        uint256 length = raw.length;

        require(length >= 3 && length <= 24, "VerdictProfileNft: handle length must be 3-24");

        for (uint256 i = 0; i < length; i++) {
            bytes1 char = raw[i];
            bool valid =
                (char >= 0x30 && char <= 0x39) ||
                (char >= 0x41 && char <= 0x5A) ||
                (char >= 0x61 && char <= 0x7A) ||
                char == 0x5F;
            require(valid, "VerdictProfileNft: handle contains invalid characters");
        }

        return handle;
    }

    function _levelForXp(uint256 xp) internal pure returns (uint256) {
        return (xp / 100) + 1;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
