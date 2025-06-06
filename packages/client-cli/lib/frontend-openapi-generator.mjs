import CodeBlockWriter from 'code-block-writer'
import { generateOperationId } from '@platformatic/client'
import { capitalize, getAllResponseCodes, getResponseContentType, getResponseTypes, is200JsonResponse } from './utils.mjs'
import camelcase from 'camelcase'
import { writeOperations } from '../../client-cli/lib/openapi-common.mjs'

export function processFrontendOpenAPI ({ schema, name, language, fullResponse, fullRequest, logger, withCredentials, propsOptional }) {
  return {
    types: generateTypesFromOpenAPI({ schema, name, fullResponse, fullRequest, propsOptional }),
    implementation: generateFrontendImplementationFromOpenAPI({ schema, name, language, fullResponse, fullRequest, logger, withCredentials })
  }
}

function generateFrontendImplementationFromOpenAPI ({ schema, name, language, fullResponse, fullRequest, logger, withCredentials }) {
  const camelCaseName = capitalize(camelcase(name))
  const { paths } = schema
  const generatedOperationIds = []
  const operations = Object.entries(paths).flatMap(([path, methods]) => {
    return Object.entries(methods).map(([method, operation]) => {
      const opId = generateOperationId(path, method, operation, generatedOperationIds)
      return {
        path,
        method,
        operation: {
          ...operation,
          operationId: opId
        }
      }
    })
  })

  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })

  writer.write('// This client was generated by Platformatic from an OpenAPI specification.')
  writer.blankLine()

  const isTsLang = language === 'ts'
  writer.conditionalWriteLine(isTsLang, `import type { ${camelCaseName} } from './${name}-types'`)
  writer.conditionalWriteLine(isTsLang, `import type * as Types from './${name}-types'`)
  writer.blankLineIfLastNot()

  writer.writeLine('// The base URL for the API. This can be overridden by calling `setBaseUrl`.')
  writer.writeLine('let baseUrl = \'\'')
  writer.writeLine('// The default headers to send within each request. This can be overridden by calling `setDefaultHeaders`.')
  writer.writeLine('let defaultHeaders = {}')
  writer.writeLine('// The additional parameters you want to pass to the `fetch` instance.')
  writer.writeLine('let defaultFetchParams = {}')
  writer.writeLine("const defaultJsonType = { 'Content-type': 'application/json; charset=utf-8' }")
  writer.newLine()
  if (isTsLang) {
    writer.write('function sanitizeUrl(url: string) : string ').block(() => {
      writer.writeLine('if (url.endsWith(\'/\')) { return url.slice(0, -1) } else { return url }')
    })
    writer.writeLine(
      'export const setBaseUrl = (newUrl: string) : void => { baseUrl = sanitizeUrl(newUrl) }'
    )
    writer.newLine()
    writer.writeLine('export const setDefaultHeaders = (headers: object): void => { defaultHeaders = headers }')
    writer.newLine()
    writer.writeLine('export const setDefaultFetchParams = (fetchParams: RequestInit): void => { defaultFetchParams = fetchParams }')
    writer.newLine()

    writer.writeLine('type JSON = Record<string, unknown>')
    writer.writeLine('/* @ts-ignore - potential unused variable */')
    writer.write('function headersToJSON(headers: Headers): JSON ').block(() => {
      writer.writeLine('const output: JSON = {}')
      writer.write('headers.forEach((value, key) => ').inlineBlock(() => {
        writer.write('output[key] = value')
      })
      writer.write(')')
      writer.writeLine('return output')
    })
  } else {
    writer.write('function sanitizeUrl(url)').block(() => {
      writer.writeLine('if (url.endsWith(\'/\')) { return url.slice(0, -1) } else { return url }')
    })
    writer.writeLine(
      `/**  @type {import('./${name}-types.d.ts').${camelCaseName}['setBaseUrl']} */`
    )
    writer.writeLine(
      'export const setBaseUrl = (newUrl) => { baseUrl = sanitizeUrl(newUrl) }'
    )
    writer.newLine()
    writer.writeLine(`/**  @type {import('./${name}-types.d.ts').${camelCaseName}['setDefaultHeaders']} */`)
    writer.writeLine('export const setDefaultHeaders = (headers) => { defaultHeaders = headers }')
    writer.newLine()
    writer.writeLine(`/**  @type {import('./${name}-types.d.ts').${camelCaseName}['setDefaultFetchParams']} */`)
    writer.writeLine('export const setDefaultFetchParams = (fetchParams) => { defaultFetchParams = fetchParams }')
    writer.newLine()
    writer.write('function headersToJSON(headers) ').block(() => {
      writer.writeLine('const output = {}')
      writer.write('headers.forEach((value, key) => ').inlineBlock(() => {
        writer.write('output[key] = value')
      })
      writer.write(')')
      writer.writeLine('return output')
    })
  }
  writer.blankLine()
  const allOperations = []
  const originalFullResponse = fullResponse
  let currentFullResponse = originalFullResponse
  function getQueryParamsString (operationParams) {
    return operationParams
      .filter((p) => p.in === 'query')
      .map((p) => p.name)
  }

  function getHeaderParams (operationParams) {
    return operationParams
      .filter((p) => p.in === 'header')
      .map((p) => p.name)
  }
  for (const operation of operations) {
    const { operationId, responses } = operation.operation
    const camelCaseOperationId = camelcase(operationId)
    const operationRequestName = `${capitalize(camelCaseOperationId)}Request`
    const operationResponseName = `${capitalize(camelCaseOperationId)}Responses`
    const underscoredOperationId = `_${operationId}`
    let queryParams = []
    let headerParams = []
    if (operation.operation.parameters) {
      queryParams = getQueryParamsString(operation.operation.parameters)
      headerParams = getHeaderParams(operation.operation.parameters)
    }
    allOperations.push(operationId)
    const { method, path } = operation
    const isGetMethod = method === 'get'

    // Only dealing with success responses
    const successResponses = Object.entries(responses).filter(([s]) => s.startsWith('2'))
    /* c8 ignore next 3 */
    if (successResponses.length !== 1) {
      currentFullResponse = true
    } else {
      // check if is empty response
      if (getResponseContentType(successResponses[0][1]) === null) {
        if (!currentFullResponse) {
          logger.warn(`Full response has been forced due to a schema with empty response for ${operationResponseName}`)
        }
        currentFullResponse = true
      }
    }
    if (isTsLang) {
      // Write
      //
      // ```ts
      // export const getMovies:Api['getMovies'] = async (request) => {
      // ```
      writer.write(
        `const ${underscoredOperationId} = async (url: string, request: Types.${operationRequestName}): Promise<Types.${operationResponseName}> =>`
      )
    } else {
      writer.write(`async function ${underscoredOperationId} (url, request)`)
    }

    writer.block(() => {
      const req = fullRequest ? 'request.path' : 'request'
      // Transform
      // /organizations/{orgId}/members/{memberId}
      // to
      // /organizations/${request.orgId}/members/${request.memberId}
      const stringLiteralPath = path.replace(/\{/gm, '${' + req + '[\'').replace(/\}/gm, '\']}')
      // GET methods need query strings instead of JSON bodies
      if (queryParams.length) {
        // query parameters should be appended to the url
        const quotedParams = queryParams.map((qp) => `'${qp}'`)
        let queryParametersType = ''
        if (isTsLang) {
          queryParametersType = `: (keyof NonNullable<Types.${fullRequest ? `${operationRequestName}['query']` : operationRequestName}>)[]`
        }
        writer.writeLine(`const queryParameters${queryParametersType} = [${quotedParams.join(', ')}]`)
        writer.writeLine('const searchParams = new URLSearchParams()')
        const query = fullRequest ? 'request.query' : 'request'
        writer.write(`if (${query}) `).inlineBlock(() => {
          writer.write('queryParameters.forEach((qp) => ').inlineBlock(() => {
            writer.writeLine(`const queryValue = ${query}?.[qp]`)
            writer.write('if (queryValue) ').inlineBlock(() => {
              writer.write('if (Array.isArray(queryValue)) ').inlineBlock(() => {
                writer.write('queryValue.forEach((p) => searchParams.append(qp, p))')
              })
              writer.write(' else ').inlineBlock(() => {
                writer.writeLine('searchParams.append(qp, queryValue.toString())')
              })
            })
            writer.writeLine(`delete ${query}?.[qp]`)
          })
          writer.write(')')
        })
        writer.blankLine()
      }
      const reqBody = fullRequest ? 'request.body' : 'request'
      if (!isGetMethod) {
        writer.writeLine(`const body = ${fullRequest ? `'body' in request ? (${reqBody}) : undefined` : reqBody}`)
        writer.writeLine('const isFormData = body instanceof FormData')
      }

      writer.write(`const headers${isTsLang ? ': HeadersInit' : ''} =`).block(() => {
        if (isGetMethod) {
          writer.writeLine('...defaultHeaders')
        } else {
          writer.writeLine('...defaultHeaders,')
          writer.writeLine('...(isFormData || body === undefined) ? {} : defaultJsonType')
        }
      })

      const headers = fullRequest ? 'request.headers' : 'request'
      headerParams.forEach((param) => {
        writer.write(`if (${headers} && ${headers}['${param}'] !== undefined)`).block(() => {
          writer.writeLine(`headers['${param}'] = ${headers}['${param}']`)
          writer.writeLine(`delete ${headers}['${param}']`)
        })
      })
      writer.blankLine()

      /* eslint-disable-next-line no-template-curly-in-string */
      const searchString = queryParams.length > 0 ? '?${searchParams.toString()}' : ''
      if (!isGetMethod) {
        writer
          .write(`const response = await fetch(\`\${url}${stringLiteralPath}${searchString}\`, `)
          .inlineBlock(() => {
            writer.write('method: ').quote().write(method.toUpperCase()).quote().write(',')
            writer.writeLine('body: isFormData ? body : JSON.stringify(body),')
            if (withCredentials) {
              writer.writeLine('credentials: \'include\',')
            }
            writer.writeLine('headers,')
            writer.writeLine('...defaultFetchParams')
          })
          .write(')')
      } else {
        writer.write(`const response = await fetch(\`\${url}${stringLiteralPath}${searchString}\`, `)
          .inlineBlock(() => {
            if (withCredentials) {
              writer.writeLine('credentials: \'include\',')
            }
            writer.writeLine('headers,')
            writer.writeLine('...defaultFetchParams')
          })
          .write(')')
      }

      writer.blankLine()
      const mappedResponses = getResponseTypes(operation.operation.responses)
      if (currentFullResponse) {
        const allResponseCodes = getAllResponseCodes(operation.operation.responses)
        if (allResponseCodes.includes(204)) {
          mappedResponses.text = mappedResponses.text.filter(code => code !== 204)
          writer.write('if (response.status === 204)').block(() => {
            writer.writeLine('return { statusCode: response.status, headers: headersToJSON(response.headers), body: undefined }')
          })
        }
        Object.keys(mappedResponses).forEach((responseType) => {
          if (mappedResponses[responseType].length > 0) {
            writer.writeLine(`const ${responseType}Responses = [${mappedResponses[responseType].join(', ')}]`)
            writer.write(`if (${responseType}Responses.includes(response.status)) `).block(() => {
              writer.write('return ').block(() => {
                writer.write('statusCode: response.status')
                if (isTsLang) {
                  writer.write(` as ${mappedResponses[responseType].join(' | ')},`)
                } else {
                  writer.write(',')
                }
                writer.writeLine('headers: headersToJSON(response.headers),')
                writer.writeLine(`body: await response.${responseType}()`)
              })
            })
          }
        })

        // write default response as fallback
        writer.writeLine('const responseType = response.headers.get(\'content-type\')?.startsWith(\'application/json\') ? \'json\' : \'text\'')
        writer.write('return ').block(() => {
          writer.write('statusCode: response.status')
          if (isTsLang) {
            writer.write(` as ${allResponseCodes.join(' | ')},`)
          } else {
            writer.write(',')
          }
          writer.writeLine('headers: headersToJSON(response.headers),')
          writer.write('body: await response[responseType]()')
        })
      } else {
        writer.write('if (!response.ok)').block(() => {
          writer.writeLine('throw new Error(await response.text())')
        })

        writer.blankLine()

        const has204Response = Object.keys(operation.operation.responses).includes('204')
        if (has204Response) {
          writer.write('if (response.status === 204) ').block(() => {
            writer.writeLine('return undefined')
          })
        }
        if (is200JsonResponse(operation.operation.responses)) {
          writer.writeLine('return await response.json()')
        } else {
          writer.writeLine('return await response.text()')
        }
      }
    })
    writer.blankLine()
    if (isTsLang) {
      writer.write(`export const ${operationId}: ${camelCaseName}['${operationId}'] = async (request: Types.${operationRequestName}): Promise<Types.${operationResponseName}> =>`).block(() => {
        writer.write(`return await ${underscoredOperationId}(baseUrl, request)`)
      })
    } else {
      // The JS version uses the JSDoc type format to offer IntelliSense autocompletion to the developer.
      //
      // ```js
      // /** @type {import('./api-types.d.ts').Api['getMovies']} */
      // export const getMovies = async (request) => {
      // ```
      //
      writer
        .writeLine(
          `/**  @type {import('./${name}-types.d.ts').${camelCaseName}['${operationId}']} */`
        )
        .write(`export const ${operationId} = async (request) =>`).block(() => {
          writer.write(`return await ${underscoredOperationId}(baseUrl, request)`)
        })
    }
    currentFullResponse = originalFullResponse
  }
  // create factory
  if (isTsLang) {
    writer.write('type BuildOptions = ').block(() => {
      writer.writeLine('headers?: object')
    })
  }

  const factoryBuildFunction = isTsLang
    ? 'export default function build (url: string, options?: BuildOptions)'
    : 'export default function build (url, options)'
  writer.write(factoryBuildFunction).block(() => {
    writer.writeLine('url = sanitizeUrl(url)')
    writer.write('if (options?.headers) ').block(() => {
      writer.writeLine('defaultHeaders = options.headers')
    })
    writer.write('return').block(() => {
      for (const [idx, op] of allOperations.entries()) {
        const underscoredOperation = `_${op}`
        const methodString = `${op}: ${underscoredOperation}.bind(url, ...arguments)`
        if (idx === allOperations.length - 1) {
          writer.writeLine(`${methodString}`)
        } else {
          writer.writeLine(`${methodString},`)
        }
      }
    })
  })
  return writer.toString()
}

function generateTypesFromOpenAPI ({ schema, name, fullRequest, fullResponse, propsOptional }) {
  const camelCaseName = capitalize(camelcase(name))
  const { paths } = schema
  const generatedOperationIds = []
  const operations = Object.entries(paths).flatMap(([path, methods]) => {
    return Object.entries(methods).map(([method, operation]) => {
      const opId = generateOperationId(path, method, operation, generatedOperationIds)
      return {
        path,
        method,
        operation: {
          ...operation,
          operationId: opId
        }
      }
    })
  })

  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })

  const interfaces = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useTabs: false,
    useSingleQuote: true
  })

  interfaces.write('export interface FullResponse<T, U extends number>').block(() => {
    interfaces.writeLine('\'statusCode\': U;')
    interfaces.writeLine('\'headers\': object;')
    interfaces.writeLine('\'body\': T;')
  })
  interfaces.blankLine()

  writer.blankLine()
  writer.write(`export interface ${camelCaseName}`).block(() => {
    writer.writeLine('setBaseUrl(newUrl: string): void;')
    writer.writeLine('setDefaultHeaders(headers: object): void;')
    writer.writeLine('setDefaultFetchParams(fetchParams: RequestInit): void;')
    writeOperations(interfaces, writer, operations, {
      fullRequest, fullResponse, optionalHeaders: [], schema, propsOptional
    })
  })

  writer.writeLine(`type PlatformaticFrontendClient = Omit<${camelCaseName}, 'setBaseUrl'>`)
  writer.write('type BuildOptions = ').block(() => {
    writer.writeLine('headers?: object')
  })
  writer.writeLine('export default function build(url: string, options?: BuildOptions): PlatformaticFrontendClient')
  return interfaces.toString() + writer.toString()
}
