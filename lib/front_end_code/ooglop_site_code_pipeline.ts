import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import * as pipe from '@aws-cdk/aws-codepipeline';
import OoglopSiteCodepipelinePolicy from '../policies/pipeline_policy';
import OoglopSiteCodebuildPolicy from '../policies/build_policy';
import OoglopSiteS3SSESSLPolicies from '../policies/s3_sse_ssl_policies';
import OoglopSiteS3PublicReadPolicy from '../policies/s3_public_read_policy';
import actions from '../pipeline_actions/ooglop_site_pipeline_actions';

export class OoglopSiteCodePipeline extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //Define S3 buckets where the website lives
    const OoglopSiteRootSiteS3BucketDef = new s3.Bucket(this, "OoglopSiteRootSiteS3Bucket",
      {
        bucketName: "ooglop-site-root-site-s3-bucket",
        versioned: false,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        encryption: s3.BucketEncryption.S3_MANAGED,
        accessControl: s3.BucketAccessControl.PUBLIC_READ,
        websiteIndexDocument: "index.html",
        websiteErrorDocument: "index.html"
      }
    );
    OoglopSiteRootSiteS3BucketDef.addToResourcePolicy(OoglopSiteS3PublicReadPolicy(OoglopSiteRootSiteS3BucketDef.bucketArn));

    //Define S3 buckets where the artifacts live
    const OoglopSitePipelineArtifactS3BucketDef = new s3.Bucket(this, "OoglopSitePipelineArtifactS3Bucket",
      {
        bucketName: "ooglop-site-pipeline-artifact-s3-bucket",
        versioned: false,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        publicReadAccess: false,
        encryption: s3.BucketEncryption.S3_MANAGED,
        accessControl: s3.BucketAccessControl.AUTHENTICATED_READ,
      }
    );
    const OoglopSiteS3SSESSLPoliciesArtifactsBucketDef = OoglopSiteS3SSESSLPolicies(OoglopSitePipelineArtifactS3BucketDef.bucketArn);
    for (var policy of OoglopSiteS3SSESSLPoliciesArtifactsBucketDef) {
      OoglopSitePipelineArtifactS3BucketDef.addToResourcePolicy(policy);
    }

    //Define pipeline role and policies for pipeline:
    const OoglopSiteCodepipelineRoleDef = new iam.Role(this, "OoglopSiteCodepipelineRole", 
      {
        description: "This role is used by the pipeline to push the front end code for OoglopSite.",
        roleName: "OoglopSiteCodepipelineRole",
        assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com")
      }
    );
    const OoglopSiteCodepipelinePolicyDef = new iam.Policy(this, "OoglopSiteCodepipelinePolicy", OoglopSiteCodepipelinePolicy);
    OoglopSiteCodepipelinePolicyDef.attachToRole(OoglopSiteCodepipelineRoleDef);
    
    //Define build role and policies for AWS CodeBuild
    const OoglopSiteCodebuildRoleDef = new iam.Role(this, "OoglopSiteCodebuildRole", 
      {
        description: "This role is used by the pipeline to push the front end code for OoglopSite.",
        roleName: "OoglopSiteCodebuildRole",
        assumedBy: new iam.CompositePrincipal(
          new iam.ServicePrincipal("codebuild.amazonaws.com"),
          new iam.ArnPrincipal(OoglopSiteCodepipelineRoleDef.roleArn)
        )
      }
    );
    const OoglopSiteCodebuildPolicyDef = new iam.Policy(this, "OoglopSiteCodebuildPolicy", OoglopSiteCodebuildPolicy(OoglopSiteRootSiteS3BucketDef.bucketArn));
    OoglopSiteCodebuildPolicyDef.attachToRole(OoglopSiteCodebuildRoleDef);

    //Define the actual pipeline: 
    new pipe.Pipeline(this, "OoglopSitePipeline", 
      {
        pipelineName: "OoglopSitePipeline",
        restartExecutionOnUpdate: false,
        role: OoglopSiteCodepipelineRoleDef,
        artifactBucket: OoglopSitePipelineArtifactS3BucketDef,
        stages: [
          {
            stageName: "Source",
            actions: [
              actions.sourceAction
            ]
          },
          {
            stageName: "Build",
            actions: [
              actions.getBuildAction(this, OoglopSiteCodebuildRoleDef, OoglopSiteRootSiteS3BucketDef.bucketName)
            ]
          }
        ]
      }
    );
  }
}
