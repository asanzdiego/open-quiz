import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/env.ts';

describe('Configuración', () => {
  it('utiliza los valores predeterminados sin variables de entorno', () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      nodeEnv: 'development',
      nextcloud: undefined,
    });
  });

  it('utiliza el puerto y el entorno proporcionados', () => {
    expect(readConfig({ PORT: '8080', NODE_ENV: 'production' })).toEqual({
      port: 8080,
      nodeEnv: 'production',
      nextcloud: undefined,
    });
  });

  it.each(['', '0', '-1', '65536', '3.5', 'abc', '3000abc', ' 3000 '])(
    'rechaza el puerto inválido %j',
    (port) => {
      expect(() => readConfig({ PORT: port })).toThrow('PORT');
    },
  );

  it('rechaza un entorno desconocido', () => {
    expect(() => readConfig({ NODE_ENV: 'desconocido' })).toThrow('NODE_ENV');
  });
});
