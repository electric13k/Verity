import { HAISB } from './haisb';
import { CMA } from './cma';
import { TUML } from './tuml';
import { ConnectorRegistry } from '../connectors/registry';
import { ExecutionContext, ExecutionResult } from '../../types/index';
import { logger } from '../../utils/logger';

export class Orchestrator {
  private registry = ConnectorRegistry.getInstance();

  public async executeTask(description: string, userId: string): Promise<any> {
    const startTime = Date.now();
    logger.info({ userId }, `Starting orchestration for task: ${description.substring(0, 50)}...`);

    // 1. HAISB Reasoning
    const haisbContext = await HAISB.process(description);
    
    // 2. CMA Plan Generation
    const { plans, selectedPlan } = await CMA.generatePlans(description);
    
    // 3. TUML Safety Checks
    const tumlChecks = await TUML.runChecks(description, selectedPlan);
    const criticalFailure = tumlChecks.some(c => !c.passed && c.severity === 'critical');

    if (criticalFailure) {
      return {
        status: 'failed',
        reasoning: haisbContext,
        plans,
        selectedPlan,
        tumlChecks,
        error: 'Critical safety checks failed'
      };
    }

    // 4. Execution
    let finalResult = '';
    const intermediateResults: any[] = [];
    let totalCost = 0;

    try {
      const context: ExecutionContext = {
        userId,
        taskId: 'temp-' + Date.now(),
        executionId: 'exec-' + Date.now()
      };

      for (const connectorId of selectedPlan.connectorIds) {
        const connector = this.registry.get(connectorId);
        if (connector && connector.enabled) {
          const result: ExecutionResult = await connector.execute({
            messages: [{ role: 'user', content: description }],
            system: `Follow this protocol: ${haisbContext.protocol}. Success criteria: ${haisbContext.successCriteria.join(', ')}`
          }, context);

          if (result.success) {
            finalResult = result.data;
            totalCost += result.usage?.cost || 0;
            intermediateResults.push({ connectorId, success: true });
          } else {
            intermediateResults.push({ connectorId, success: false, error: result.error });
          }
        }
      }
    } catch (error: any) {
      logger.error('Execution error', error);
      return {
        status: 'failed',
        reasoning: haisbContext,
        plans,
        selectedPlan,
        tumlChecks,
        error: error.message
      };
    }

    const executionTime = Date.now() - startTime;

    return {
      status: 'completed',
      reasoning: haisbContext,
      plans,
      selectedPlan,
      tumlChecks,
      intermediateResults,
      finalResult,
      totalCost,
      executionTime
    };
  }
}
