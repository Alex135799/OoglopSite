import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OoglopSiteInfrastructure } from '../lib/infrastructure/ooglop_site_infrastructure';
import { OoglopSiteCodePipeline } from '../lib/front_end_code/ooglop_site_code_pipeline';

test('Infrastructure stack is empty for now', () => {
  const app = new cdk.App();
  const stack = new OoglopSiteInfrastructure(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  expect(template.toJSON().Resources ?? {}).toEqual({});
});

test('Pipeline stack defines the site buckets and pipeline', () => {
  const app = new cdk.App();
  const stack = new OoglopSiteCodePipeline(app, 'TestPipeline');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::S3::Bucket', 2);
  template.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
  template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Name: 'OoglopSitePipeline',
  });
});
