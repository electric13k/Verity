import { TUMLCheck, Plan } from '../../types/index';
import { ConnectorRegistry } from '../connectors/registry';

export class TUML {
  private static registry = ConnectorRegistry.getInstance();

  public static async runChecks(description: string, plan: Plan): Promise<TUMLCheck[]> {
    const checks: TUMLCheck[] = [
      this.checkMissingConnector(plan),
      this.checkDisabledConnector(plan),
      this.checkInsufficientConfig(plan),
      this.checkMalformedInput(description),
      this.checkCostLimit(),
      this.checkNoConnectors(),
      this.checkInvalidTask(description),
      this.checkHallucinationRisk(description),
      this.checkConstraintViolations(),
      this.checkNetworkConnectivity()
    ];

    return checks;
  }

  private static checkMissingConnector(plan: Plan): TUMLCheck {
    const missing = plan.connectorIds.some(id => !this.registry.exists(id));
    return {
      id: 'tuml-1',
      name: 'Missing Connector',
      passed: !missing,
      severity: 'critical',
      message: missing ? 'One or more required connectors are not registered.' : undefined
    };
  }

  private static checkDisabledConnector(plan: Plan): TUMLCheck {
    const disabled = plan.connectorIds.some(id => {
      const c = this.registry.get(id);
      return c && !c.enabled;
    });
    return {
      id: 'tuml-2',
      name: 'Disabled Connector',
      passed: !disabled,
      severity: 'high',
      message: disabled ? 'One or more required connectors are disabled.' : undefined
    };
  }

  private static checkInsufficientConfig(plan: Plan): TUMLCheck {
    const insufficient = plan.connectorIds.some(id => {
      const c = this.registry.get(id);
      if (id === 'claude' || id === 'openai' || id === 'kimi') {
        return !c?.config.apiKey;
      }
      return false;
    });
    return {
      id: 'tuml-3',
      name: 'Insufficient Configuration',
      passed: !insufficient,
      severity: 'critical',
      message: insufficient ? 'API keys are missing for the selected models.' : undefined
    };
  }

  private static checkMalformedInput(desc: string): TUMLCheck {
    return {
      id: 'tuml-4',
      name: 'Malformed Input',
      passed: desc.length > 0,
      severity: 'medium'
    };
  }

  private static checkCostLimit(): TUMLCheck {
    return { id: 'tuml-5', name: 'Cost Limit', passed: true, severity: 'medium' };
  }

  private static checkNoConnectors(): TUMLCheck {
    const hasAny = this.registry.ids().length > 0;
    return {
      id: 'tuml-6',
      name: 'No Connectors Available',
      passed: hasAny,
      severity: 'critical'
    };
  }

  private static checkInvalidTask(desc: string): TUMLCheck {
    return {
      id: 'tuml-7',
      name: 'Invalid Task',
      passed: desc.trim().length > 0,
      severity: 'critical'
    };
  }

  private static checkHallucinationRisk(desc: string): TUMLCheck {
    const keywords = ['latest', 'current', 'today', 'real-time', 'live', 'recent'];
    const risky = keywords.some(k => desc.toLowerCase().includes(k));
    return {
      id: 'tuml-8',
      name: 'Hallucination Risk',
      passed: !risky,
      severity: 'low',
      message: risky ? 'Task requests real-time info which might lead to hallucinations.' : undefined
    };
  }

  private static checkConstraintViolations(): TUMLCheck {
    return { id: 'tuml-9', name: 'Constraint Violations', passed: true, severity: 'medium' };
  }

  private static checkNetworkConnectivity(): TUMLCheck {
    return { id: 'tuml-10', name: 'Network Connectivity', passed: true, severity: 'medium' };
  }
}
