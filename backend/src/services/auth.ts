import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../types/index';

export class AuthService {
  public static generateToken(user: User): string {
    return jwt.sign(
      { id: user.id, email: user.email },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  public static verifyToken(token: string): any {
    try {
      return jwt.verify(token, env.JWT_SECRET);
    } catch (error) {
      return null;
    }
  }
}
