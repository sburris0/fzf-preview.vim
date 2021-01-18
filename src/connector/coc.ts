import type { DiagnosticItem, ImplementationProvider, ReferenceProvider, TypeDefinitionProvider } from "coc.nvim"
import { CancellationTokenSource, languages, workspace } from "coc.nvim"
import { uniqWith } from "lodash"
import type { Location as CocLocation } from "vscode-languageserver-types"

import { getLineFromFile } from "@/connector/util"
import { pluginCall } from "@/plugin"
import { collapseHome, existsFileAsync, getCurrentFilePath, getCurrentPath } from "@/system/file"
import { dropFileProtocol, filePathToRelativeFilePath } from "@/system/project"
import type { Diagnostic, DiagnosticLevel } from "@/type"

type ReferenceProviders = Array<{
  provider: ReferenceProvider
}>

type TypeDefinitionProviders = Array<{
  provider: TypeDefinitionProvider
}>

type ImplementationProviders = Array<{
  provider: ImplementationProvider
}>

const diagnosticItemToData = async (
  item: DiagnosticItem,
  option?: { currentFile: string }
): Promise<Diagnostic | null> => {
  if (!(await existsFileAsync(item.file))) {
    return null
  }

  const currentPath = await getCurrentPath()
  const file = filePathToRelativeFilePath(item.file, currentPath)

  if (file == null) {
    return null
  }
  if (option?.currentFile != null && option?.currentFile !== file) {
    return null
  }

  return {
    file,
    lineNumber: item.lnum,
    severity: item.severity as DiagnosticLevel,
    message: item.message,
  }
}

export const getDiagnostics = async (): Promise<Array<Diagnostic>> => {
  const diagnosticItems = (await pluginCall("CocAction", ["diagnosticList"])) as Array<DiagnosticItem>
  const diagnostics = await Promise.all(diagnosticItems.map(async (item) => await diagnosticItemToData(item)))

  return diagnostics.filter((diagnostic): diagnostic is Diagnostic => diagnostic != null)
}

export const getCurrentDiagnostics = async (): Promise<Array<Diagnostic>> => {
  const currentFile = await getCurrentFilePath()
  const diagnosticItems = (await pluginCall("CocAction", ["diagnosticList"])) as Array<DiagnosticItem>
  const diagnostics = await Promise.all(
    diagnosticItems.map(async (item) => await diagnosticItemToData(item, { currentFile }))
  )

  return diagnostics.filter((diagnostic): diagnostic is Diagnostic => diagnostic != null)
}

type Location = {
  file: string
  lineNumber: number
  text: string
}

const getCurrentState = async () => {
  const { document, position } = await workspace.getCurrentState()
  const range = (await workspace.document).getWordRangeAtPosition(position)
  const symbol = range && range != null ? document.getText(range) : ""

  return { document, position, symbol }
}

const cocLocationToLocation = async (locations: Array<CocLocation>): Promise<Array<Location>> => {
  const currentPath = await getCurrentPath()

  return (
    await Promise.all(
      locations.map(async (location) => {
        const lineNumber = location.range.start.line + 1
        const absoluteFilePath = decodeURIComponent(dropFileProtocol(location.uri))
        const filePath =
          new RegExp(`^${currentPath}`).exec(absoluteFilePath) != null
            ? filePathToRelativeFilePath(absoluteFilePath, currentPath)
            : collapseHome(absoluteFilePath)

        if (filePath == null) {
          return null
        }
        const text = await getLineFromFile(absoluteFilePath, lineNumber)

        return { file: filePath, lineNumber, text }
      })
    )
  ).filter((location): location is Location => location != null)
}

export const getReferences = async (): Promise<{ references: Array<Location>; symbol: string }> => {
  let locations: Array<CocLocation> = []

  const { document, position, symbol } = await getCurrentState()
  const tokenSource = new CancellationTokenSource()

  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const providers: ReferenceProviders = Array.from(languages.referenceManager.providers)
  for (const { provider } of providers) {
    // eslint-disable-next-line no-await-in-loop
    const references = await provider.provideReferences(
      document,
      position,
      {
        includeDeclaration: false,
      },
      tokenSource.token
    )
    if (references != null) {
      locations = [...locations, ...references]
    }
  }

  const references = uniqWith(
    await cocLocationToLocation(locations),
    (a, b) => a.file === b.file && a.lineNumber === b.lineNumber && a.text === b.text
  )

  return {
    references,
    symbol,
  }
}

export const getTypeDefinition = async (): Promise<{ typeDefinitions: Array<Location>; symbol: string }> => {
  let locations: Array<CocLocation> = []

  const { document, position, symbol } = await getCurrentState()
  const tokenSource = new CancellationTokenSource()

  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const providers: TypeDefinitionProviders = Array.from(languages.typeDefinitionManager.providers)
  for (const { provider } of providers) {
    // eslint-disable-next-line no-await-in-loop
    const typeDefinitions = (await provider.provideTypeDefinition(
      document,
      position,
      tokenSource.token
    )) as Array<CocLocation>
    if (typeDefinitions != null) {
      locations = [...locations, ...typeDefinitions]
    }
  }

  const typeDefinitions = uniqWith(
    await cocLocationToLocation(locations),
    (a, b) => a.file === b.file && a.lineNumber === b.lineNumber && a.text === b.text
  )

  return {
    typeDefinitions,
    symbol,
  }
}

export const getImplementations = async (): Promise<{ implementations: Array<Location>; symbol: string }> => {
  let locations: Array<CocLocation> = []

  const { document, position, symbol } = await getCurrentState()
  const tokenSource = new CancellationTokenSource()

  // @ts-expect-error
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const providers: ImplementationProviders = Array.from(languages.implementationManager.providers)
  for (const { provider } of providers) {
    // eslint-disable-next-line no-await-in-loop
    const implementations = (await provider.provideImplementation(
      document,
      position,
      tokenSource.token
    )) as Array<CocLocation>
    if (implementations != null) {
      locations = [...locations, ...implementations]
    }
  }

  const implementations = uniqWith(
    await cocLocationToLocation(locations),
    (a, b) => a.file === b.file && a.lineNumber === b.lineNumber && a.text === b.text
  )

  return {
    implementations,
    symbol,
  }
}
