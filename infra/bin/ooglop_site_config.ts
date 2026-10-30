#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { OoglopSiteInfrastructure } from '../lib/infrastructure/ooglop_site_infrastructure';
import { OoglopSiteCodePipeline } from '../lib/front_end_code/ooglop_site_code_pipeline';

const app = new cdk.App();
new OoglopSiteInfrastructure(app, 'OoglopSiteInfrastructure');
new OoglopSiteCodePipeline(app, 'OoglopSiteCodePipeline');
