import * as iam from '@aws-cdk/aws-iam';

export default function(s3Arn : string) {
  return new iam.PolicyStatement(
    {
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:GetObject"
      ],
      resources: [
        s3Arn,
        s3Arn + "/*"
      ],
      principals: [
        new iam.AnyPrincipal()
      ]
    }
  );
}