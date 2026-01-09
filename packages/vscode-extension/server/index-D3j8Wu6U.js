import { A as resolveAwsSdkSigV4Config, B as normalizeProvider, D as getSmithyContext, F as EndpointCache, G as resolveEndpoint, I as awsEndpointFunctions, J as customEndpointFunctions, h as toUtf8, i as fromUtf8, K as parseUrl, L as AwsRestJsonProtocol, N as NoOpLogger, M as AwsSdkSigV4Signer, O as toBase64, P as fromBase64, Q as emitWarningIfUnsupportedVersion, R as resolveDefaultsModeConfig, S as emitWarningIfUnsupportedVersion$1, T as loadConfig, U as streamCollector, V as Hash, W as createDefaultUserAgentProvider, X as calculateBodyLength, Y as NODE_APP_ID_CONFIG_OPTIONS, Z as NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, _ as NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, $ as NODE_RETRY_MODE_CONFIG_OPTIONS, a0 as DEFAULT_RETRY_MODE, a1 as NODE_REGION_CONFIG_FILE_OPTIONS, a2 as NODE_REGION_CONFIG_OPTIONS, a3 as NODE_MAX_ATTEMPT_CONFIG_OPTIONS, a4 as NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, a5 as loadConfigsForDefaultMode, a6 as getAwsRegionExtensionConfiguration, a7 as getDefaultExtensionConfiguration, a8 as getHttpHandlerExtensionConfiguration, a9 as resolveAwsRegionExtensionConfiguration, aa as resolveDefaultRuntimeConfig, ab as resolveHttpHandlerRuntimeConfig, ac as Client, ad as resolveUserAgentConfig, ae as resolveRetryConfig, af as resolveRegionConfig, ag as resolveEndpointConfig, ah as resolveHostHeaderConfig, ai as getSchemaSerdePlugin, aj as getUserAgentPlugin, ak as getRetryPlugin, al as getContentLengthPlugin, am as getHostHeaderPlugin, an as getLoggerPlugin, ao as getRecursionDetectionPlugin, ap as getHttpAuthSchemeEndpointRuleSetPlugin, aq as DefaultIdentityProviderConfig, ar as getHttpSigningPlugin, as as ServiceException, at as TypeRegistry, au as Command, av as getEndpointPlugin } from "./index.js";
import { p as packageInfo } from "./package-BnG9Uibi.js";
import { N as NoAuthSigner } from "./noAuth-DjsddSW4.js";
import { N as NodeHttpHandler } from "./node-http-handler-BKRyDgaC.js";
const defaultSSOOIDCHttpAuthSchemeParametersProvider = async (config, context, input) => {
  return {
    operation: getSmithyContext(context).operation,
    region: await normalizeProvider(config.region)() || (() => {
      throw new Error("expected `region` to be configured for `aws.auth#sigv4`");
    })()
  };
};
function createAwsAuthSigv4HttpAuthOption(authParameters) {
  return {
    schemeId: "aws.auth#sigv4",
    signingProperties: {
      name: "sso-oauth",
      region: authParameters.region
    },
    propertiesExtractor: (config, context) => ({
      signingProperties: {
        config,
        context
      }
    })
  };
}
function createSmithyApiNoAuthHttpAuthOption(authParameters) {
  return {
    schemeId: "smithy.api#noAuth"
  };
}
const defaultSSOOIDCHttpAuthSchemeProvider = (authParameters) => {
  const options = [];
  switch (authParameters.operation) {
    case "CreateToken": {
      options.push(createSmithyApiNoAuthHttpAuthOption());
      break;
    }
    default: {
      options.push(createAwsAuthSigv4HttpAuthOption(authParameters));
    }
  }
  return options;
};
const resolveHttpAuthSchemeConfig = (config) => {
  const config_0 = resolveAwsSdkSigV4Config(config);
  return Object.assign(config_0, {
    authSchemePreference: normalizeProvider(config.authSchemePreference ?? [])
  });
};
const resolveClientEndpointParameters = (options) => {
  return Object.assign(options, {
    useDualstackEndpoint: options.useDualstackEndpoint ?? false,
    useFipsEndpoint: options.useFipsEndpoint ?? false,
    defaultSigningName: "sso-oauth"
  });
};
const commonParams = {
  UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
  Endpoint: { type: "builtInParams", name: "endpoint" },
  Region: { type: "builtInParams", name: "region" },
  UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" }
};
const u = "required", v = "fn", w = "argv", x = "ref";
const a = true, b = "isSet", c = "booleanEquals", d = "error", e = "endpoint", f = "tree", g = "PartitionResult", h = "getAttr", i = { [u]: false, "type": "string" }, j = { [u]: true, "default": false, "type": "boolean" }, k = { [x]: "Endpoint" }, l = { [v]: c, [w]: [{ [x]: "UseFIPS" }, true] }, m = { [v]: c, [w]: [{ [x]: "UseDualStack" }, true] }, n = {}, o = { [v]: h, [w]: [{ [x]: g }, "supportsFIPS"] }, p = { [x]: g }, q = { [v]: c, [w]: [true, { [v]: h, [w]: [p, "supportsDualStack"] }] }, r = [l], s = [m], t = [{ [x]: "Region" }];
const _data = { parameters: { Region: i, UseDualStack: j, UseFIPS: j, Endpoint: i }, rules: [{ conditions: [{ [v]: b, [w]: [k] }], rules: [{ conditions: r, error: "Invalid Configuration: FIPS and custom endpoint are not supported", type: d }, { conditions: s, error: "Invalid Configuration: Dualstack and custom endpoint are not supported", type: d }, { endpoint: { url: k, properties: n, headers: n }, type: e }], type: f }, { conditions: [{ [v]: b, [w]: t }], rules: [{ conditions: [{ [v]: "aws.partition", [w]: t, assign: g }], rules: [{ conditions: [l, m], rules: [{ conditions: [{ [v]: c, [w]: [a, o] }, q], rules: [{ endpoint: { url: "https://oidc-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS and DualStack are enabled, but this partition does not support one or both", type: d }], type: f }, { conditions: r, rules: [{ conditions: [{ [v]: c, [w]: [o, a] }], rules: [{ conditions: [{ [v]: "stringEquals", [w]: [{ [v]: h, [w]: [p, "name"] }, "aws-us-gov"] }], endpoint: { url: "https://oidc.{Region}.amazonaws.com", properties: n, headers: n }, type: e }, { endpoint: { url: "https://oidc-fips.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS is enabled but this partition does not support FIPS", type: d }], type: f }, { conditions: s, rules: [{ conditions: [q], rules: [{ endpoint: { url: "https://oidc.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "DualStack is enabled but this partition does not support DualStack", type: d }], type: f }, { endpoint: { url: "https://oidc.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }], type: f }, { error: "Invalid Configuration: Missing Region", type: d }] };
const ruleSet = _data;
const cache = new EndpointCache({
  size: 50,
  params: ["Endpoint", "Region", "UseDualStack", "UseFIPS"]
});
const defaultEndpointResolver = (endpointParams, context = {}) => {
  return cache.get(endpointParams, () => resolveEndpoint(ruleSet, {
    endpointParams,
    logger: context.logger
  }));
};
customEndpointFunctions.aws = awsEndpointFunctions;
const getRuntimeConfig$1 = (config) => {
  return {
    apiVersion: "2019-06-10",
    base64Decoder: config?.base64Decoder ?? fromBase64,
    base64Encoder: config?.base64Encoder ?? toBase64,
    disableHostPrefix: config?.disableHostPrefix ?? false,
    endpointProvider: config?.endpointProvider ?? defaultEndpointResolver,
    extensions: config?.extensions ?? [],
    httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? defaultSSOOIDCHttpAuthSchemeProvider,
    httpAuthSchemes: config?.httpAuthSchemes ?? [
      {
        schemeId: "aws.auth#sigv4",
        identityProvider: (ipc) => ipc.getIdentityProvider("aws.auth#sigv4"),
        signer: new AwsSdkSigV4Signer()
      },
      {
        schemeId: "smithy.api#noAuth",
        identityProvider: (ipc) => ipc.getIdentityProvider("smithy.api#noAuth") || (async () => ({})),
        signer: new NoAuthSigner()
      }
    ],
    logger: config?.logger ?? new NoOpLogger(),
    protocol: config?.protocol ?? new AwsRestJsonProtocol({ defaultNamespace: "com.amazonaws.ssooidc" }),
    serviceId: config?.serviceId ?? "SSO OIDC",
    urlParser: config?.urlParser ?? parseUrl,
    utf8Decoder: config?.utf8Decoder ?? fromUtf8,
    utf8Encoder: config?.utf8Encoder ?? toUtf8
  };
};
const getRuntimeConfig = (config) => {
  emitWarningIfUnsupportedVersion(process.version);
  const defaultsMode = resolveDefaultsModeConfig(config);
  const defaultConfigProvider = () => defaultsMode().then(loadConfigsForDefaultMode);
  const clientSharedValues = getRuntimeConfig$1(config);
  emitWarningIfUnsupportedVersion$1(process.version);
  const loaderConfig = {
    profile: config?.profile,
    logger: clientSharedValues.logger
  };
  return {
    ...clientSharedValues,
    ...config,
    runtime: "node",
    defaultsMode,
    authSchemePreference: config?.authSchemePreference ?? loadConfig(NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, loaderConfig),
    bodyLengthChecker: config?.bodyLengthChecker ?? calculateBodyLength,
    defaultUserAgentProvider: config?.defaultUserAgentProvider ?? createDefaultUserAgentProvider({ serviceId: clientSharedValues.serviceId, clientVersion: packageInfo.version }),
    maxAttempts: config?.maxAttempts ?? loadConfig(NODE_MAX_ATTEMPT_CONFIG_OPTIONS, config),
    region: config?.region ?? loadConfig(NODE_REGION_CONFIG_OPTIONS, { ...NODE_REGION_CONFIG_FILE_OPTIONS, ...loaderConfig }),
    requestHandler: NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider),
    retryMode: config?.retryMode ?? loadConfig({
      ...NODE_RETRY_MODE_CONFIG_OPTIONS,
      default: async () => (await defaultConfigProvider()).retryMode || DEFAULT_RETRY_MODE
    }, config),
    sha256: config?.sha256 ?? Hash.bind(null, "sha256"),
    streamCollector: config?.streamCollector ?? streamCollector,
    useDualstackEndpoint: config?.useDualstackEndpoint ?? loadConfig(NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
    useFipsEndpoint: config?.useFipsEndpoint ?? loadConfig(NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, loaderConfig),
    userAgentAppId: config?.userAgentAppId ?? loadConfig(NODE_APP_ID_CONFIG_OPTIONS, loaderConfig)
  };
};
const getHttpAuthExtensionConfiguration = (runtimeConfig) => {
  const _httpAuthSchemes = runtimeConfig.httpAuthSchemes;
  let _httpAuthSchemeProvider = runtimeConfig.httpAuthSchemeProvider;
  let _credentials = runtimeConfig.credentials;
  return {
    setHttpAuthScheme(httpAuthScheme) {
      const index = _httpAuthSchemes.findIndex((scheme) => scheme.schemeId === httpAuthScheme.schemeId);
      if (index === -1) {
        _httpAuthSchemes.push(httpAuthScheme);
      } else {
        _httpAuthSchemes.splice(index, 1, httpAuthScheme);
      }
    },
    httpAuthSchemes() {
      return _httpAuthSchemes;
    },
    setHttpAuthSchemeProvider(httpAuthSchemeProvider) {
      _httpAuthSchemeProvider = httpAuthSchemeProvider;
    },
    httpAuthSchemeProvider() {
      return _httpAuthSchemeProvider;
    },
    setCredentials(credentials) {
      _credentials = credentials;
    },
    credentials() {
      return _credentials;
    }
  };
};
const resolveHttpAuthRuntimeConfig = (config) => {
  return {
    httpAuthSchemes: config.httpAuthSchemes(),
    httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
    credentials: config.credentials()
  };
};
const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
  const extensionConfiguration = Object.assign(getAwsRegionExtensionConfiguration(runtimeConfig), getDefaultExtensionConfiguration(runtimeConfig), getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
  extensions.forEach((extension) => extension.configure(extensionConfiguration));
  return Object.assign(runtimeConfig, resolveAwsRegionExtensionConfiguration(extensionConfiguration), resolveDefaultRuntimeConfig(extensionConfiguration), resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};
class SSOOIDCClient extends Client {
  config;
  constructor(...[configuration]) {
    const _config_0 = getRuntimeConfig(configuration || {});
    super(_config_0);
    this.initConfig = _config_0;
    const _config_1 = resolveClientEndpointParameters(_config_0);
    const _config_2 = resolveUserAgentConfig(_config_1);
    const _config_3 = resolveRetryConfig(_config_2);
    const _config_4 = resolveRegionConfig(_config_3);
    const _config_5 = resolveHostHeaderConfig(_config_4);
    const _config_6 = resolveEndpointConfig(_config_5);
    const _config_7 = resolveHttpAuthSchemeConfig(_config_6);
    const _config_8 = resolveRuntimeExtensions(_config_7, configuration?.extensions || []);
    this.config = _config_8;
    this.middlewareStack.use(getSchemaSerdePlugin(this.config));
    this.middlewareStack.use(getUserAgentPlugin(this.config));
    this.middlewareStack.use(getRetryPlugin(this.config));
    this.middlewareStack.use(getContentLengthPlugin(this.config));
    this.middlewareStack.use(getHostHeaderPlugin(this.config));
    this.middlewareStack.use(getLoggerPlugin(this.config));
    this.middlewareStack.use(getRecursionDetectionPlugin(this.config));
    this.middlewareStack.use(getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
      httpAuthSchemeParametersProvider: defaultSSOOIDCHttpAuthSchemeParametersProvider,
      identityProviderConfigProvider: async (config) => new DefaultIdentityProviderConfig({
        "aws.auth#sigv4": config.credentials
      })
    }));
    this.middlewareStack.use(getHttpSigningPlugin(this.config));
  }
  destroy() {
    super.destroy();
  }
}
let SSOOIDCServiceException$1 = class SSOOIDCServiceException extends ServiceException {
  constructor(options) {
    super(options);
    Object.setPrototypeOf(this, SSOOIDCServiceException.prototype);
  }
};
let AccessDeniedException$1 = class AccessDeniedException extends SSOOIDCServiceException$1 {
  name = "AccessDeniedException";
  $fault = "client";
  error;
  reason;
  error_description;
  constructor(opts) {
    super({
      name: "AccessDeniedException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, AccessDeniedException.prototype);
    this.error = opts.error;
    this.reason = opts.reason;
    this.error_description = opts.error_description;
  }
};
let AuthorizationPendingException$1 = class AuthorizationPendingException extends SSOOIDCServiceException$1 {
  name = "AuthorizationPendingException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "AuthorizationPendingException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, AuthorizationPendingException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let ExpiredTokenException$1 = class ExpiredTokenException extends SSOOIDCServiceException$1 {
  name = "ExpiredTokenException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "ExpiredTokenException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, ExpiredTokenException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let InternalServerException$1 = class InternalServerException extends SSOOIDCServiceException$1 {
  name = "InternalServerException";
  $fault = "server";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "InternalServerException",
      $fault: "server",
      ...opts
    });
    Object.setPrototypeOf(this, InternalServerException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let InvalidClientException$1 = class InvalidClientException extends SSOOIDCServiceException$1 {
  name = "InvalidClientException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "InvalidClientException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, InvalidClientException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let InvalidGrantException$1 = class InvalidGrantException extends SSOOIDCServiceException$1 {
  name = "InvalidGrantException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "InvalidGrantException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, InvalidGrantException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let InvalidRequestException$1 = class InvalidRequestException extends SSOOIDCServiceException$1 {
  name = "InvalidRequestException";
  $fault = "client";
  error;
  reason;
  error_description;
  constructor(opts) {
    super({
      name: "InvalidRequestException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, InvalidRequestException.prototype);
    this.error = opts.error;
    this.reason = opts.reason;
    this.error_description = opts.error_description;
  }
};
let InvalidScopeException$1 = class InvalidScopeException extends SSOOIDCServiceException$1 {
  name = "InvalidScopeException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "InvalidScopeException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, InvalidScopeException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let SlowDownException$1 = class SlowDownException extends SSOOIDCServiceException$1 {
  name = "SlowDownException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "SlowDownException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, SlowDownException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let UnauthorizedClientException$1 = class UnauthorizedClientException extends SSOOIDCServiceException$1 {
  name = "UnauthorizedClientException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "UnauthorizedClientException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, UnauthorizedClientException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
let UnsupportedGrantTypeException$1 = class UnsupportedGrantTypeException extends SSOOIDCServiceException$1 {
  name = "UnsupportedGrantTypeException";
  $fault = "client";
  error;
  error_description;
  constructor(opts) {
    super({
      name: "UnsupportedGrantTypeException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, UnsupportedGrantTypeException.prototype);
    this.error = opts.error;
    this.error_description = opts.error_description;
  }
};
const _ADE = "AccessDeniedException";
const _APE = "AuthorizationPendingException";
const _AT = "AccessToken";
const _CS = "ClientSecret";
const _CT = "CreateToken";
const _CTR = "CreateTokenRequest";
const _CTRr = "CreateTokenResponse";
const _CV = "CodeVerifier";
const _ETE = "ExpiredTokenException";
const _ICE = "InvalidClientException";
const _IGE = "InvalidGrantException";
const _IRE = "InvalidRequestException";
const _ISE = "InternalServerException";
const _ISEn = "InvalidScopeException";
const _IT = "IdToken";
const _RT = "RefreshToken";
const _SDE = "SlowDownException";
const _UCE = "UnauthorizedClientException";
const _UGTE = "UnsupportedGrantTypeException";
const _aT = "accessToken";
const _c = "client";
const _cI = "clientId";
const _cS = "clientSecret";
const _cV = "codeVerifier";
const _co = "code";
const _dC = "deviceCode";
const _e = "error";
const _eI = "expiresIn";
const _ed = "error_description";
const _gT = "grantType";
const _h = "http";
const _hE = "httpError";
const _iT = "idToken";
const _r = "reason";
const _rT = "refreshToken";
const _rU = "redirectUri";
const _s = "scope";
const _se = "server";
const _sm = "smithy.ts.sdk.synthetic.com.amazonaws.ssooidc";
const _tT = "tokenType";
const n0 = "com.amazonaws.ssooidc";
var AccessToken = [0, n0, _AT, 8, 0];
var ClientSecret = [0, n0, _CS, 8, 0];
var CodeVerifier = [0, n0, _CV, 8, 0];
var IdToken = [0, n0, _IT, 8, 0];
var RefreshToken = [0, n0, _RT, 8, 0];
var AccessDeniedException2 = [
  -3,
  n0,
  _ADE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _r, _ed],
  [0, 0, 0]
];
TypeRegistry.for(n0).registerError(AccessDeniedException2, AccessDeniedException$1);
var AuthorizationPendingException2 = [
  -3,
  n0,
  _APE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(AuthorizationPendingException2, AuthorizationPendingException$1);
var CreateTokenRequest = [
  3,
  n0,
  _CTR,
  0,
  [_cI, _cS, _gT, _dC, _co, _rT, _s, _rU, _cV],
  [0, [() => ClientSecret, 0], 0, 0, 0, [() => RefreshToken, 0], 64 | 0, 0, [() => CodeVerifier, 0]]
];
var CreateTokenResponse = [
  3,
  n0,
  _CTRr,
  0,
  [_aT, _tT, _eI, _rT, _iT],
  [[() => AccessToken, 0], 0, 1, [() => RefreshToken, 0], [() => IdToken, 0]]
];
var ExpiredTokenException2 = [
  -3,
  n0,
  _ETE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(ExpiredTokenException2, ExpiredTokenException$1);
var InternalServerException2 = [
  -3,
  n0,
  _ISE,
  {
    [_e]: _se,
    [_hE]: 500
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(InternalServerException2, InternalServerException$1);
var InvalidClientException2 = [
  -3,
  n0,
  _ICE,
  {
    [_e]: _c,
    [_hE]: 401
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(InvalidClientException2, InvalidClientException$1);
var InvalidGrantException2 = [
  -3,
  n0,
  _IGE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(InvalidGrantException2, InvalidGrantException$1);
var InvalidRequestException2 = [
  -3,
  n0,
  _IRE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _r, _ed],
  [0, 0, 0]
];
TypeRegistry.for(n0).registerError(InvalidRequestException2, InvalidRequestException$1);
var InvalidScopeException2 = [
  -3,
  n0,
  _ISEn,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(InvalidScopeException2, InvalidScopeException$1);
var SlowDownException2 = [
  -3,
  n0,
  _SDE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(SlowDownException2, SlowDownException$1);
var UnauthorizedClientException2 = [
  -3,
  n0,
  _UCE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(UnauthorizedClientException2, UnauthorizedClientException$1);
var UnsupportedGrantTypeException2 = [
  -3,
  n0,
  _UGTE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _ed],
  [0, 0]
];
TypeRegistry.for(n0).registerError(UnsupportedGrantTypeException2, UnsupportedGrantTypeException$1);
var SSOOIDCServiceException2 = [-3, _sm, "SSOOIDCServiceException", 0, [], []];
TypeRegistry.for(_sm).registerError(SSOOIDCServiceException2, SSOOIDCServiceException$1);
var CreateToken = [
  9,
  n0,
  _CT,
  {
    [_h]: ["POST", "/token", 200]
  },
  () => CreateTokenRequest,
  () => CreateTokenResponse
];
class CreateTokenCommand extends Command.classBuilder().ep(commonParams).m(function(Command2, cs, config, o2) {
  return [getEndpointPlugin(config, Command2.getEndpointParameterInstructions())];
}).s("AWSSSOOIDCService", "CreateToken", {}).n("SSOOIDCClient", "CreateTokenCommand").sc(CreateToken).build() {
}
export {
  Command as $Command,
  AccessDeniedException$1 as AccessDeniedException,
  AuthorizationPendingException$1 as AuthorizationPendingException,
  CreateTokenCommand,
  ExpiredTokenException$1 as ExpiredTokenException,
  InternalServerException$1 as InternalServerException,
  InvalidClientException$1 as InvalidClientException,
  InvalidGrantException$1 as InvalidGrantException,
  InvalidRequestException$1 as InvalidRequestException,
  InvalidScopeException$1 as InvalidScopeException,
  SSOOIDCClient,
  SSOOIDCServiceException$1 as SSOOIDCServiceException,
  SlowDownException$1 as SlowDownException,
  UnauthorizedClientException$1 as UnauthorizedClientException,
  UnsupportedGrantTypeException$1 as UnsupportedGrantTypeException,
  Client as __Client
};
