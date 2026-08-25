
resource "aws_iam_user" "apps-deployer" {

  name = "apps-deployer"

  tags = {
    env = "dev"
  }


  force_destroy = false
}
