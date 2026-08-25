from pathlib import Path
from schema import write_tf, EXEC_MODE
import tempfile

def _render(ir):
    tmp = Path(tempfile.mkdtemp())
    write_tf(ir, tmp)
    tf = (tmp/"main.tf").read_text()
    return tf

def test_s3_template_renders():
    ir = {"resource":"aws_s3_bucket","name":"logs-bucket",
          "properties":{"versioning":True,"block_public_access":True,"region":"us-east-1","tags":{"env":"dev"}},
          "actions":["plan"]}
    tf = _render(ir)
    assert 'resource "aws_s3_bucket" "logs_bucket"' in tf
    if EXEC_MODE == "offline":
        assert "skip_credentials_validation" in tf
