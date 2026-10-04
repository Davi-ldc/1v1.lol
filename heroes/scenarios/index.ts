import type { Scenario } from '../../tests/e2e/scenarios/index';
import { beam } from './beam';
import { beamcancel } from './beamcancel';
import { beamcancellan } from './beamcancellan';
import { beamjump } from './beamjump';
import { beamlan } from './beamlan';
import { beammaterial } from './beammaterial';
import { beamsuper } from './beamsuper';
import { beamsuperlan } from './beamsuperlan';
import { beamsword } from './beamsword';
import { beamswordanim } from './beamswordanim';
import { beamswordlan } from './beamswordlan';
import { elastic } from './elastic';
import { elasticslap } from './elasticslap';
import { elasticslaplan } from './elasticslaplan';
import { elasticstretch, elasticstretchlan } from './elasticstretch';

/** The custom heroes' scenarios (heroes/README.md); each names the heroes it needs under `--heroes`. */
export const heroScenarios: Record<string, Scenario> = { beam, beamlan, beamsuper, beamsuperlan, beamcancel,
  beamcancellan, beamjump, beammaterial, beamsword, beamswordlan, beamswordanim, elastic, elasticstretch,
  elasticstretchlan, elasticslap, elasticslaplan };
