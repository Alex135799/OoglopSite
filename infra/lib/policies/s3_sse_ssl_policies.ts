import * as iam from '@aws-cdk/aws-iam';

export default function(s3Arn : string) {
  return [
    new iam.PolicyStatement(
      {
        effect: iam.Effect.DENY,
        actions: [
          "s3:PutObject"
        ],
        resources: [
          s3Arn,
          s3Arn + "/*"
        ],
        conditions: {
          "StringNotEquals": {
            "s3:x-amz-server-side-encryption": "aws:kms"
          }
        },
        principals: [
          new iam.AnyPrincipal()
        ]
      }
    ),
    new iam.PolicyStatement(
      {
        effect: iam.Effect.DENY,
        actions: [
          "s3:*"
        ],
        resources: [
          s3Arn,
          s3Arn + "/*"
        ],
        conditions: {
          "Bool": {
            "aws:SecureTransport": "false"
          }
        },
        principals: [
          new iam.AnyPrincipal()
        ]
      }
    )
  ];
}