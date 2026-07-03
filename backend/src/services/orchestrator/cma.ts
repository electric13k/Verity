import { Plan } from '../../types/index';
import { ConnectorRegistry } from '../connectors/registry';

export class CMA {
  private static registry = ConnectorRegistry.getInstance();

  public static async generatePlans(description: string): Promise<{ plans: Plan[], selectedPlan: Plan }> {
    const plans: Plan[] = [
      this.createCostOptimizedPlan(),
      this.createSpeedOptimizedPlan(),
      this.createQualityOptimizedPlan()
    ];

    // Score plans
    plans.forEach(plan => {
      plan.score = this.calculateScore(plan);
    });

    // Auto-select best-scored plan
    const selectedPlan = [...plans].sort((a, b) => b.score - a.score)[0];

    return { plans, selectedPlan };
  }

  private static createCostOptimizedPlan(): Plan {
    const llms = this.registry.getLLMs().filter(c => c.enabled);
    const cheapest = llms.sort((a, b) => a.costPerCall - b.costPerCall)[0];
    
    return {
      id: 'plan-cost',
      name: 'Cost Optimized',
      description: 'Prioritizes the most affordable available model',
      steps: ['Analyze request', 'Execute with low-cost model', 'Format output'],
      connectorIds: cheapest ? [cheapest.id] : [],
      estimatedCost: cheapest ? cheapest.costPerCall : 0,
      estimatedLatency: 2000,
      riskLevel: 'medium',
      score: 0
    };
  }

  private static createSpeedOptimizedPlan(): Plan {
    const ollama = this.registry.get('ollama');
    const useOllama = ollama && ollama.enabled;
    
    return {
      id: 'plan-speed',
      name: 'Speed Optimized',
      description: 'Prioritizes local execution or fastest response time',
      steps: ['Direct model query', 'Instant response generation'],
      connectorIds: useOllama ? ['ollama'] : (this.registry.ids().length > 0 ? [this.registry.ids()[0]] : []),
      estimatedCost: 0,
      estimatedLatency: 500,
      riskLevel: 'low',
      score: 0
    };
  }

  private static createQualityOptimizedPlan(): Plan {
    const claude = this.registry.get('claude');
    const openai = this.registry.get('openai');
    const best = (claude && claude.enabled) ? 'claude' : ((openai && openai.enabled) ? 'openai' : '');
    
    return {
      id: 'plan-quality',
      name: 'Quality Optimized',
      description: 'Uses the most capable reasoning models available',
      steps: ['Deep reasoning step', 'High-fidelity generation', 'Self-correction check'],
      connectorIds: best ? [best] : [],
      estimatedCost: best === 'claude' ? 0.015 : 0.01,
      estimatedLatency: 5000,
      riskLevel: 'low',
      score: 0
    };
  }

  private static calculateScore(plan: Plan): number {
    let score = 50; // Base score

    // Cost limit compliance (mock check)
    score += 20;

    // Latency priority bonus
    if (plan.estimatedLatency < 1000) score += 15;

    // Risk level
    if (plan.riskLevel === 'low') score += 15;
    else if (plan.riskLevel === 'medium') score += 5;
    else score -= 10;

    return score;
  }
}
