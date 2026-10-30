import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as OoglopSiteConfig from '../lib/infrastructure/ooglop_site_infrastructure';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new OoglopSiteConfig.OoglopSiteInfrastructure(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
