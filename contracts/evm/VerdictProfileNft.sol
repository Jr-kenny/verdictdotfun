// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract VerdictProfileNft is Initializable, OwnableUpgradeable, UUPSUpgradeable, ERC721Upgradeable {
    using Strings for uint256;

    uint256 public constant MAX_LEVEL = 10;
    uint256 public constant LEVEL_TWO_XP = 1_000;

    struct VerdictBadge {
        uint256 tokenId;
        address profileAddress;
        string handle;
        uint256 permanentXp;
        uint256 level;
        bool linked;
    }

    string private _baseMetadataUri;

    mapping(uint256 => VerdictBadge) private _badgesByTokenId;
    mapping(address => uint256) private _tokenIdByProfile;
    mapping(address => bool) public operators;

    event VerdictBadgeMinted(address indexed owner, address indexed profileAddress, uint256 indexed tokenId, string handle);
    event VerdictBadgeSynced(
        address indexed owner,
        address indexed profileAddress,
        uint256 indexed tokenId,
        uint256 permanentXp,
        uint256 level
    );
    event VerdictBadgeLinkUpdated(address indexed profileAddress, uint256 indexed tokenId, bool linked);
    event OperatorUpdated(address indexed operator, bool allowed);

    modifier onlyOperator() {
        require(operators[msg.sender] || owner() == msg.sender, "VerdictProfileNft: caller is not an operator");
        _;
    }

    function initialize(
        address initialOwner,
        string memory name_,
        string memory symbol_,
        string memory baseMetadataUri_
    ) public initializer {
        __Ownable_init(initialOwner);
        __ERC721_init(name_, symbol_);

        _baseMetadataUri = baseMetadataUri_;
    }

    function syncProfile(
        address profileOwner,
        address profileAddress,
        string calldata handle,
        uint256 permanentXp
    ) external onlyOperator returns (uint256 tokenId) {
        require(profileOwner != address(0), "VerdictProfileNft: owner is required");
        require(profileAddress != address(0), "VerdictProfileNft: profile address is required");

        tokenId = uint256(uint160(profileAddress));
        uint256 existingTokenId = _tokenIdByProfile[profileAddress];
        uint256 level = _levelForPermanentXp(permanentXp);

        if (existingTokenId == 0) {
            require(permanentXp >= LEVEL_TWO_XP, "VerdictProfileNft: profile has not reached level 2");

            _tokenIdByProfile[profileAddress] = tokenId;
            _badgesByTokenId[tokenId] = VerdictBadge({
                tokenId: tokenId,
                profileAddress: profileAddress,
                handle: _cleanHandle(handle),
                permanentXp: permanentXp,
                level: level,
                linked: true
            });

            _safeMint(profileOwner, tokenId);
            emit VerdictBadgeMinted(profileOwner, profileAddress, tokenId, _badgesByTokenId[tokenId].handle);
        } else {
            tokenId = existingTokenId;
            VerdictBadge storage badge = _badgesByTokenId[tokenId];
            require(badge.profileAddress == profileAddress, "VerdictProfileNft: badge profile mismatch");

            if (bytes(handle).length != 0) {
                badge.handle = _cleanHandle(handle);
            }

            if (permanentXp > badge.permanentXp) {
                badge.permanentXp = permanentXp;
            }

            badge.level = _levelForPermanentXp(badge.permanentXp);

            if (badge.linked && ownerOf(tokenId) != profileOwner) {
                _transfer(ownerOf(tokenId), profileOwner, tokenId);
            }
        }

        emit VerdictBadgeSynced(ownerOf(tokenId), profileAddress, tokenId, _badgesByTokenId[tokenId].permanentXp, _badgesByTokenId[tokenId].level);
    }

    function unlinkBadge(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "VerdictProfileNft: only the badge owner can unlink");
        VerdictBadge storage badge = _badgesByTokenId[tokenId];
        require(badge.linked, "VerdictProfileNft: badge is already unlinked");
        badge.linked = false;
        emit VerdictBadgeLinkUpdated(badge.profileAddress, tokenId, false);
    }

    function relinkBadge(uint256 tokenId) external onlyOperator {
        _requireOwned(tokenId);
        VerdictBadge storage badge = _badgesByTokenId[tokenId];
        require(!badge.linked, "VerdictProfileNft: badge is already linked");
        badge.linked = true;
        emit VerdictBadgeLinkUpdated(badge.profileAddress, tokenId, true);
    }

    function transferLinkedBadge(address profileAddress, address newOwner) external onlyOperator {
        require(newOwner != address(0), "VerdictProfileNft: new owner is required");
        uint256 tokenId = _tokenIdByProfile[profileAddress];
        require(tokenId != 0, "VerdictProfileNft: badge does not exist");

        VerdictBadge storage badge = _badgesByTokenId[tokenId];
        require(badge.linked, "VerdictProfileNft: badge is unlinked");

        address currentOwner = ownerOf(tokenId);
        if (currentOwner != newOwner) {
            _transfer(currentOwner, newOwner, tokenId);
        }
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "VerdictProfileNft: operator is required");
        operators[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    function setBaseMetadataUri(string calldata newBaseMetadataUri) external onlyOwner {
        _baseMetadataUri = newBaseMetadataUri;
    }

    function hasBadge(address profileAddress) external view returns (bool) {
        return _tokenIdByProfile[profileAddress] != 0;
    }

    function tokenOfProfile(address profileAddress) external view returns (uint256) {
        uint256 tokenId = _tokenIdByProfile[profileAddress];
        require(tokenId != 0, "VerdictProfileNft: badge does not exist");
        return tokenId;
    }

    function getBadgeByProfile(address profileAddress) external view returns (VerdictBadge memory) {
        uint256 tokenId = _tokenIdByProfile[profileAddress];
        require(tokenId != 0, "VerdictProfileNft: badge does not exist");
        return _badgesByTokenId[tokenId];
    }

    function getBadge(uint256 tokenId) external view returns (VerdictBadge memory) {
        _requireOwned(tokenId);
        return _badgesByTokenId[tokenId];
    }

    function previewLevelForXp(uint256 permanentXp) external pure returns (uint256) {
        return _levelForPermanentXp(permanentXp);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseMetadataUri, tokenId.toString());
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            VerdictBadge storage badge = _badgesByTokenId[tokenId];
            if (badge.linked) {
                require(
                    operators[msg.sender] || owner() == msg.sender,
                    "VerdictProfileNft: linked badges must be transferred by the relayer"
                );
            }
        }

        return super._update(to, tokenId, auth);
    }

    function _cleanHandle(string memory handle) internal pure returns (string memory) {
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

    function _levelForPermanentXp(uint256 permanentXp) internal pure returns (uint256) {
        uint256 level = 1;
        uint256 requiredForNext = LEVEL_TWO_XP;
        uint256 cumulativeXp = 0;

        while (level < MAX_LEVEL) {
            cumulativeXp += requiredForNext;
            if (permanentXp < cumulativeXp) {
                return level;
            }
            level += 1;
            requiredForNext *= 2;
        }

        return MAX_LEVEL;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
