import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as pipe from '@aws-cdk/aws-codepipeline';
import * as act from '@aws-cdk/aws-codepipeline-actions';
import * as build from '@aws-cdk/aws-codebuild';
import getOoglopSiteBuildSpec from './build_spec/ooglop_site_build_spec';

const sourceOutput = new pipe.Artifact();
const buildOutput = new pipe.Artifact();

const sourceAction = new act.GitHubSourceAction({
  actionName: "SourceAction",
  owner: "Alex135799",
  repo: "OoglopSite",
  oauthToken: cdk.SecretValue.secretsManager('ooglopcid-github-token'),
  output: sourceOutput,
  branch: "master",
});

const getBuildAction = function(scope : cdk.Stack, roleIn : iam.IRole, rootS3BucketName : string) {
  return new act.CodeBuildAction({
    actionName: "BuildAction",
    input: sourceOutput,
    outputs: [ buildOutput ],
    role: roleIn,
    project: new build.PipelineProject(scope, "OoglopSiteBuildSiteProject", 
      {
        projectName: "OoglopSiteBuildSiteProject",
        description: "This is the build project to include in OoglopSite pipeline.",
        role: roleIn,
        timeout: cdk.Duration.minutes(10),
        buildSpec: build.BuildSpec.fromObject(getOoglopSiteBuildSpec(rootS3BucketName)),
        environmentVariables: {
          "NODE_ENV": { value: "prod" },
          "CI": { value: "true" }
        },
        environment: {
          buildImage: build.LinuxBuildImage.fromCodeBuildImageId("aws/codebuild/nodejs:10.1.0"),
          computeType: build.ComputeType.SMALL
        }
      }
    )
  })
}



export default {
  "sourceAction": sourceAction,
  "getBuildAction": getBuildAction
}