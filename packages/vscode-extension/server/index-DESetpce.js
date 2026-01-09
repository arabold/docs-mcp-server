import { A as resolveAwsSdkSigV4Config, B as normalizeProvider, D as getSmithyContext, F as EndpointCache, G as resolveEndpoint, I as awsEndpointFunctions, J as customEndpointFunctions, h as toUtf8, i as fromUtf8, K as parseUrl, L as AwsRestJsonProtocol, N as NoOpLogger, M as AwsSdkSigV4Signer, O as toBase64, P as fromBase64, Q as emitWarningIfUnsupportedVersion, R as resolveDefaultsModeConfig, S as emitWarningIfUnsupportedVersion$1, T as loadConfig, U as streamCollector, V as Hash, W as createDefaultUserAgentProvider, X as calculateBodyLength, Y as NODE_APP_ID_CONFIG_OPTIONS, Z as NODE_USE_FIPS_ENDPOINT_CONFIG_OPTIONS, _ as NODE_USE_DUALSTACK_ENDPOINT_CONFIG_OPTIONS, $ as NODE_RETRY_MODE_CONFIG_OPTIONS, a0 as DEFAULT_RETRY_MODE, a1 as NODE_REGION_CONFIG_FILE_OPTIONS, a2 as NODE_REGION_CONFIG_OPTIONS, a3 as NODE_MAX_ATTEMPT_CONFIG_OPTIONS, a4 as NODE_AUTH_SCHEME_PREFERENCE_OPTIONS, a5 as loadConfigsForDefaultMode, a6 as getAwsRegionExtensionConfiguration, a7 as getDefaultExtensionConfiguration, a8 as getHttpHandlerExtensionConfiguration, a9 as resolveAwsRegionExtensionConfiguration, aa as resolveDefaultRuntimeConfig, ab as resolveHttpHandlerRuntimeConfig, ac as Client, ad as resolveUserAgentConfig, ae as resolveRetryConfig, af as resolveRegionConfig, ag as resolveEndpointConfig, ah as resolveHostHeaderConfig, ai as getSchemaSerdePlugin, aj as getUserAgentPlugin, ak as getRetryPlugin, al as getContentLengthPlugin, am as getHostHeaderPlugin, an as getLoggerPlugin, ao as getRecursionDetectionPlugin, ap as getHttpAuthSchemeEndpointRuleSetPlugin, aq as DefaultIdentityProviderConfig, ar as getHttpSigningPlugin, as as ServiceException, at as TypeRegistry, au as Command, av as getEndpointPlugin } from "./index.js";
import { p as packageInfo } from "./package-BnG9Uibi.js";
import { N as NoAuthSigner } from "./noAuth-DjsddSW4.js";
import { N as NodeHttpHandler } from "./node-http-handler-BKRyDgaC.js";
const defaultSigninHttpAuthSchemeParametersProvider = async (config, context, input) => {
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
      name: "signin",
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
const defaultSigninHttpAuthSchemeProvider = (authParameters) => {
  const options = [];
  switch (authParameters.operation) {
    case "CreateOAuth2Token": {
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
    defaultSigningName: "signin"
  });
};
const commonParams = {
  UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
  Endpoint: { type: "builtInParams", name: "endpoint" },
  Region: { type: "builtInParams", name: "region" },
  UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" }
};
const u = "required", v = "fn", w = "argv", x = "ref";
const a = true, b = "isSet", c = "booleanEquals", d = "error", e = "endpoint", f = "tree", g = "PartitionResult", h = "stringEquals", i = { [u]: true, "default": false, "type": "boolean" }, j = { [u]: false, "type": "string" }, k = { [x]: "Endpoint" }, l = { [v]: c, [w]: [{ [x]: "UseFIPS" }, true] }, m = { [v]: c, [w]: [{ [x]: "UseDualStack" }, true] }, n = {}, o = { [v]: "getAttr", [w]: [{ [x]: g }, "name"] }, p = { [v]: c, [w]: [{ [x]: "UseFIPS" }, false] }, q = { [v]: c, [w]: [{ [x]: "UseDualStack" }, false] }, r = { [v]: "getAttr", [w]: [{ [x]: g }, "supportsFIPS"] }, s = { [v]: c, [w]: [true, { [v]: "getAttr", [w]: [{ [x]: g }, "supportsDualStack"] }] }, t = [{ [x]: "Region" }];
const _data = { parameters: { UseDualStack: i, UseFIPS: i, Endpoint: j, Region: j }, rules: [{ conditions: [{ [v]: b, [w]: [k] }], rules: [{ conditions: [l], error: "Invalid Configuration: FIPS and custom endpoint are not supported", type: d }, { rules: [{ conditions: [m], error: "Invalid Configuration: Dualstack and custom endpoint are not supported", type: d }, { endpoint: { url: k, properties: n, headers: n }, type: e }], type: f }], type: f }, { rules: [{ conditions: [{ [v]: b, [w]: t }], rules: [{ conditions: [{ [v]: "aws.partition", [w]: t, assign: g }], rules: [{ conditions: [{ [v]: h, [w]: [o, "aws"] }, p, q], endpoint: { url: "https://{Region}.signin.aws.amazon.com", properties: n, headers: n }, type: e }, { conditions: [{ [v]: h, [w]: [o, "aws-cn"] }, p, q], endpoint: { url: "https://{Region}.signin.amazonaws.cn", properties: n, headers: n }, type: e }, { conditions: [{ [v]: h, [w]: [o, "aws-us-gov"] }, p, q], endpoint: { url: "https://{Region}.signin.amazonaws-us-gov.com", properties: n, headers: n }, type: e }, { conditions: [l, m], rules: [{ conditions: [{ [v]: c, [w]: [a, r] }, s], rules: [{ endpoint: { url: "https://signin-fips.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS and DualStack are enabled, but this partition does not support one or both", type: d }], type: f }, { conditions: [l, q], rules: [{ conditions: [{ [v]: c, [w]: [r, a] }], rules: [{ endpoint: { url: "https://signin-fips.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "FIPS is enabled but this partition does not support FIPS", type: d }], type: f }, { conditions: [p, m], rules: [{ conditions: [s], rules: [{ endpoint: { url: "https://signin.{Region}.{PartitionResult#dualStackDnsSuffix}", properties: n, headers: n }, type: e }], type: f }, { error: "DualStack is enabled but this partition does not support DualStack", type: d }], type: f }, { endpoint: { url: "https://signin.{Region}.{PartitionResult#dnsSuffix}", properties: n, headers: n }, type: e }], type: f }], type: f }, { error: "Invalid Configuration: Missing Region", type: d }], type: f }] };
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
    apiVersion: "2023-01-01",
    base64Decoder: config?.base64Decoder ?? fromBase64,
    base64Encoder: config?.base64Encoder ?? toBase64,
    disableHostPrefix: config?.disableHostPrefix ?? false,
    endpointProvider: config?.endpointProvider ?? defaultEndpointResolver,
    extensions: config?.extensions ?? [],
    httpAuthSchemeProvider: config?.httpAuthSchemeProvider ?? defaultSigninHttpAuthSchemeProvider,
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
    protocol: config?.protocol ?? new AwsRestJsonProtocol({ defaultNamespace: "com.amazonaws.signin" }),
    serviceId: config?.serviceId ?? "Signin",
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
class SigninClient extends Client {
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
      httpAuthSchemeParametersProvider: defaultSigninHttpAuthSchemeParametersProvider,
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
let SigninServiceException$1 = class SigninServiceException extends ServiceException {
  constructor(options) {
    super(options);
    Object.setPrototypeOf(this, SigninServiceException.prototype);
  }
};
let AccessDeniedException$1 = class AccessDeniedException extends SigninServiceException$1 {
  name = "AccessDeniedException";
  $fault = "client";
  error;
  constructor(opts) {
    super({
      name: "AccessDeniedException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, AccessDeniedException.prototype);
    this.error = opts.error;
  }
};
let InternalServerException$1 = class InternalServerException extends SigninServiceException$1 {
  name = "InternalServerException";
  $fault = "server";
  error;
  constructor(opts) {
    super({
      name: "InternalServerException",
      $fault: "server",
      ...opts
    });
    Object.setPrototypeOf(this, InternalServerException.prototype);
    this.error = opts.error;
  }
};
let TooManyRequestsError$1 = class TooManyRequestsError extends SigninServiceException$1 {
  name = "TooManyRequestsError";
  $fault = "client";
  error;
  constructor(opts) {
    super({
      name: "TooManyRequestsError",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, TooManyRequestsError.prototype);
    this.error = opts.error;
  }
};
let ValidationException$1 = class ValidationException extends SigninServiceException$1 {
  name = "ValidationException";
  $fault = "client";
  error;
  constructor(opts) {
    super({
      name: "ValidationException",
      $fault: "client",
      ...opts
    });
    Object.setPrototypeOf(this, ValidationException.prototype);
    this.error = opts.error;
  }
};
const _ADE = "AccessDeniedException";
const _AT = "AccessToken";
const _COAT = "CreateOAuth2Token";
const _COATR = "CreateOAuth2TokenRequest";
const _COATRB = "CreateOAuth2TokenRequestBody";
const _COATRBr = "CreateOAuth2TokenResponseBody";
const _COATRr = "CreateOAuth2TokenResponse";
const _ISE = "InternalServerException";
const _RT = "RefreshToken";
const _TMRE = "TooManyRequestsError";
const _VE = "ValidationException";
const _aKI = "accessKeyId";
const _aT = "accessToken";
const _c = "client";
const _cI = "clientId";
const _cV = "codeVerifier";
const _co = "code";
const _e = "error";
const _eI = "expiresIn";
const _gT = "grantType";
const _h = "http";
const _hE = "httpError";
const _iT = "idToken";
const _jN = "jsonName";
const _m = "message";
const _rT = "refreshToken";
const _rU = "redirectUri";
const _s = "server";
const _sAK = "secretAccessKey";
const _sT = "sessionToken";
const _sm = "smithy.ts.sdk.synthetic.com.amazonaws.signin";
const _tI = "tokenInput";
const _tO = "tokenOutput";
const _tT = "tokenType";
const n0 = "com.amazonaws.signin";
var RefreshToken = [0, n0, _RT, 8, 0];
var AccessDeniedException2 = [
  -3,
  n0,
  _ADE,
  {
    [_e]: _c
  },
  [_e, _m],
  [0, 0]
];
TypeRegistry.for(n0).registerError(AccessDeniedException2, AccessDeniedException$1);
var AccessToken = [
  3,
  n0,
  _AT,
  8,
  [_aKI, _sAK, _sT],
  [
    [
      0,
      {
        [_jN]: _aKI
      }
    ],
    [
      0,
      {
        [_jN]: _sAK
      }
    ],
    [
      0,
      {
        [_jN]: _sT
      }
    ]
  ]
];
var CreateOAuth2TokenRequest = [
  3,
  n0,
  _COATR,
  0,
  [_tI],
  [[() => CreateOAuth2TokenRequestBody, 16]]
];
var CreateOAuth2TokenRequestBody = [
  3,
  n0,
  _COATRB,
  0,
  [_cI, _gT, _co, _rU, _cV, _rT],
  [
    [
      0,
      {
        [_jN]: _cI
      }
    ],
    [
      0,
      {
        [_jN]: _gT
      }
    ],
    0,
    [
      0,
      {
        [_jN]: _rU
      }
    ],
    [
      0,
      {
        [_jN]: _cV
      }
    ],
    [
      () => RefreshToken,
      {
        [_jN]: _rT
      }
    ]
  ]
];
var CreateOAuth2TokenResponse = [
  3,
  n0,
  _COATRr,
  0,
  [_tO],
  [[() => CreateOAuth2TokenResponseBody, 16]]
];
var CreateOAuth2TokenResponseBody = [
  3,
  n0,
  _COATRBr,
  0,
  [_aT, _tT, _eI, _rT, _iT],
  [
    [
      () => AccessToken,
      {
        [_jN]: _aT
      }
    ],
    [
      0,
      {
        [_jN]: _tT
      }
    ],
    [
      1,
      {
        [_jN]: _eI
      }
    ],
    [
      () => RefreshToken,
      {
        [_jN]: _rT
      }
    ],
    [
      0,
      {
        [_jN]: _iT
      }
    ]
  ]
];
var InternalServerException2 = [
  -3,
  n0,
  _ISE,
  {
    [_e]: _s,
    [_hE]: 500
  },
  [_e, _m],
  [0, 0]
];
TypeRegistry.for(n0).registerError(InternalServerException2, InternalServerException$1);
var TooManyRequestsError2 = [
  -3,
  n0,
  _TMRE,
  {
    [_e]: _c,
    [_hE]: 429
  },
  [_e, _m],
  [0, 0]
];
TypeRegistry.for(n0).registerError(TooManyRequestsError2, TooManyRequestsError$1);
var ValidationException2 = [
  -3,
  n0,
  _VE,
  {
    [_e]: _c,
    [_hE]: 400
  },
  [_e, _m],
  [0, 0]
];
TypeRegistry.for(n0).registerError(ValidationException2, ValidationException$1);
var SigninServiceException2 = [-3, _sm, "SigninServiceException", 0, [], []];
TypeRegistry.for(_sm).registerError(SigninServiceException2, SigninServiceException$1);
var CreateOAuth2Token = [
  9,
  n0,
  _COAT,
  {
    [_h]: ["POST", "/v1/token", 200]
  },
  () => CreateOAuth2TokenRequest,
  () => CreateOAuth2TokenResponse
];
class CreateOAuth2TokenCommand extends Command.classBuilder().ep(commonParams).m(function(Command2, cs, config, o2) {
  return [getEndpointPlugin(config, Command2.getEndpointParameterInstructions())];
}).s("Signin", "CreateOAuth2Token", {}).n("SigninClient", "CreateOAuth2TokenCommand").sc(CreateOAuth2Token).build() {
}
export {
  Command as $Command,
  AccessDeniedException$1 as AccessDeniedException,
  CreateOAuth2TokenCommand,
  InternalServerException$1 as InternalServerException,
  SigninClient,
  SigninServiceException$1 as SigninServiceException,
  TooManyRequestsError$1 as TooManyRequestsError,
  ValidationException$1 as ValidationException,
  Client as __Client
};
