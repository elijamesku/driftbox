resource "aws_s3_bucket" "new_bucket" {
  bucket = "new-bucket"
  tags = {
    Name = "new-bucket"
  }
}
