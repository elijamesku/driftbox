# tests/test_apply.py
import tempfile
from pathlib import Path

import schema

def test_apply_mode_simulation():
    # ensure offline simulation (no terraform calls)
    schema.EXEC_MODE = "offline"

    ir = {
        "resource": "aws_s3_bucket",
        "name": "demo-bucket",
        "properties": {"versioning": True, "block_public_access": True, "region": "us-east-1"},
        "actions": ["apply"],
    }

    # policy & opa should pass
    schema.policy_validate(ir)

    # run in a temp dir
    d = Path(tempfile.mkdtemp(prefix="tf_apply_test_"))
    try:
        schema.write_tf(ir, d)
        result = schema.run_infra(ir, d)
        assert result["step"] == "apply"
        assert result["ok"] is True
        # summary present and parsable
        s = result["summary"]
        assert isinstance(s, dict) and "to_add" in s
    finally:
        # cleanup temp dir
        import shutil
        shutil.rmtree(d, ignore_errors=True)
