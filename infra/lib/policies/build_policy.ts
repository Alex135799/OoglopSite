import * as iam from '@aws-cdk/aws-iam';

export default function(s3Arn : string) {
  return {
    "policyName": "OoglopSiteCodebuildPolicy",
    "statements": [
      new iam.PolicyStatement(
        {
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            "*"
          ],
        }
      ),
      new iam.PolicyStatement(
        {
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:List*",
            "s3:Get*",
            "s3:Put*",
            "s3:Delete*"
          ],
          resources: [
            s3Arn,
            s3Arn + "/*"
          ],
        }
      )
    ]
  };
}