from pathlib import Path
import ast


CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"


def _storage_fields(contract_path: Path, class_name: str) -> list[str]:
    module = ast.parse(contract_path.read_text("utf-8"))

    for node in module.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            fields: list[str] = []
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    fields.append(item.target.id)
            return fields

    raise AssertionError(f"Could not find class {class_name} in {contract_path}")


def test_vdt_core_preserves_profile_factory_storage_prefix():
    legacy_fields = _storage_fields(CONTRACTS_DIR / "profile_factory.py", "ProfileFactory")
    core_fields = _storage_fields(CONTRACTS_DIR / "vdt_core.py", "VDTCore")

    assert core_fields[: len(legacy_fields)] == legacy_fields
