import { KeyValueStorage } from "./KeyValueStorage";
import { RedisClient } from "redis";
import { RedisKeyValueStorage } from "./RedisKeyValueStorage";
import { generateNewSecrets, Secrets } from "./secrets";
import { JWTRepository } from "./JWTRepository";

export interface SignerConfig {
  mode: "symmetric" | "asymmetric";
  secretLength: number;
  tokenExpiry: number;
  rotationInterval: number;
}

const SECRETS_KEY = "SECRETS";

export class Signer<JWTPayload extends string | object | Buffer> {

  private constructor(
    private readonly kv: KeyValueStorage ,
    private readonly config: SignerConfig
  ) {}

  private readonly jwtRepository = new JWTRepository<JWTPayload>(
    this.getKeys,
    this.kv,
    this.config
  );

  public getJwtRepository() {
    return this.jwtRepository;
  }

  private interval?: NodeJS.Timer;

  private startRotationInterval() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    
    this.interval = setInterval(this.rotate, this.config.rotationInterval * 1000);
  }

  public async init() {
    const secrets = generateNewSecrets(null, this.config);
    await this.kv.set(
      SECRETS_KEY,
      JSON.stringify(secrets)
    );
    this.startRotationInterval();
  }

  public async rotate() {
    const oldValues = await this.getKeys();
    if (!oldValues) {
      throw new Error("Illegal State: init() must have run beforehand");
    }

    const newValues = generateNewSecrets(oldValues, this.config);
    await this.kv.set(
      SECRETS_KEY,
      JSON.stringify(newValues)
    );
  }

  private async getKeys() {
    const result = await this.kv.get(SECRETS_KEY);
    if (!result) {
      throw new Error("Illegal State: init() must have run beforehand");
    }

    return JSON.parse(result) as Secrets;
  }

  public async getPublic() {
    const { current, old } = await this.getKeys() ?? {};
    return {
      current: current?.publicKey,
      old: old?.publicKey
    }
  }

  static async fromKvStorage(kv: KeyValueStorage, config: SignerConfig) {
    const signer = new Signer(kv, config);
    await signer.init();
    return signer;
  }

  static async fromRedis(redis: RedisClient, config: SignerConfig) {
    return await this.fromKvStorage(new RedisKeyValueStorage(redis), config);
  }

}