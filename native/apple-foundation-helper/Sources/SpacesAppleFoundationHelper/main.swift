import Foundation
import FoundationModels

struct HelperRequest: Decodable {
    let operation: String
    let model: String?
    let messages: [HelperMessage]?
    let tools: [HelperToolDefinition]?
    let temperature: Double?
    let maxTokens: Int?
}

struct HelperMessage: Decodable {
    let role: String
    let content: String
    let toolCallId: String?
    let toolName: String?
}

struct HelperToolDefinition: Decodable {
    let name: String
    let description: String
    let inputSchema: JSONValue?
}

struct HelperToolCall: Encodable {
    let name: String
    let arguments: JSONValue
}

struct HelperUsage: Encodable {
    let promptTokens: Int
    let completionTokens: Int
    let totalTokens: Int
    let tokenAccuracy: String
    let usageSource: String
}

struct HelperResponse: Encodable {
    var available: Bool?
    var reason: String?
    var text: String?
    var toolCall: HelperToolCall?
    var finishReason: String?
    var usage: HelperUsage?
}

struct StructuredGatewayResponse: Decodable {
    let type: String
    let content: String?
    let name: String?
    let argumentsJSON: String?
}

enum JSONValue: Codable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
            return
        }
        if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
            return
        }

        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unsupported JSON value"
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            if value.rounded(.towardZero) == value {
                try container.encode(Int(value))
            } else {
                try container.encode(value)
            }
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    init(any value: Any) {
        switch value {
        case let string as String:
            self = .string(string)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else {
                self = .number(number.doubleValue)
            }
        case let object as [String: Any]:
            self = .object(object.mapValues(JSONValue.init(any:)))
        case let array as [Any]:
            self = .array(array.map(JSONValue.init(any:)))
        default:
            self = .null
        }
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self {
            return value
        }
        return nil
    }
}

@main
struct SpacesAppleFoundationHelper {
    static func main() async {
        do {
            let request = try decodeRequest()
            let response = try await handle(request: request)
            try writeResponse(response)
        } catch {
            let response = HelperResponse(
                available: nil,
                reason: error.localizedDescription,
                text: nil,
                toolCall: nil,
                finishReason: "error",
                usage: nil
            )
            try? writeResponse(response)
            Foundation.exit(1)
        }
    }

    private static func handle(request: HelperRequest) async throws -> HelperResponse {
        switch request.operation.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "checkAvailability":
            return availabilityResponse()
        case "generate":
            return try await generateResponse(for: request)
        default:
            throw HelperError("Unsupported operation: \(request.operation)")
        }
    }

    private static func availabilityResponse() -> HelperResponse {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return HelperResponse(
                available: true,
                reason: "Apple Intelligence available.",
                text: nil,
                toolCall: nil,
                finishReason: nil,
                usage: nil
            )
        case .unavailable(.deviceNotEligible):
            return HelperResponse(
                available: false,
                reason: "Device is not eligible for Apple Intelligence.",
                text: nil,
                toolCall: nil,
                finishReason: nil,
                usage: nil
            )
        case .unavailable(.appleIntelligenceNotEnabled):
            return HelperResponse(
                available: false,
                reason: "Apple Intelligence is not enabled.",
                text: nil,
                toolCall: nil,
                finishReason: nil,
                usage: nil
            )
        case .unavailable(.modelNotReady):
            return HelperResponse(
                available: false,
                reason: "Apple Intelligence model is not ready.",
                text: nil,
                toolCall: nil,
                finishReason: nil,
                usage: nil
            )
        case .unavailable(let other):
            return HelperResponse(
                available: false,
                reason: "Apple Intelligence unavailable: \(String(describing: other)).",
                text: nil,
                toolCall: nil,
                finishReason: nil,
                usage: nil
            )
        }
    }

    private static func generateResponse(for request: HelperRequest) async throws -> HelperResponse {
        let availability = availabilityResponse()
        if availability.available != true {
            return availability
        }

        let messages = request.messages ?? []
        let instructions = renderInstructions(from: messages)
        let prompt = renderPrompt(from: messages)
        let session = instructions.isEmpty
            ? LanguageModelSession()
            : LanguageModelSession(instructions: instructions)
        let options = GenerationOptions(
            temperature: request.temperature,
            maximumResponseTokens: request.maxTokens
        )

        if let tools = request.tools, !tools.isEmpty {
            let schema = try buildStructuredResponseSchema(tools: tools)
            let response = try await session.respond(
                to: prompt,
                schema: schema,
                options: options
            )
            let structured = try decodeStructuredResponse(from: response.content)
            let usage = estimateUsage(messages: messages, output: structured.content ?? structured.argumentsJSON ?? "")
            if structured.type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "tool_call",
               let name = structured.name?.trimmingCharacters(in: .whitespacesAndNewlines),
               !name.isEmpty {
                let arguments = parseArguments(structured.argumentsJSON)
                return HelperResponse(
                    available: nil,
                    reason: nil,
                    text: nil,
                    toolCall: HelperToolCall(name: name, arguments: arguments),
                    finishReason: "tool_calls",
                    usage: usage
                )
            }

            return HelperResponse(
                available: nil,
                reason: nil,
                text: (structured.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                toolCall: nil,
                finishReason: "stop",
                usage: usage
            )
        }

        let response = try await session.respond(to: prompt, options: options)
        let content = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return HelperResponse(
            available: nil,
            reason: nil,
            text: content,
            toolCall: nil,
            finishReason: "stop",
            usage: estimateUsage(messages: messages, output: content)
        )
    }

    private static func buildStructuredResponseSchema(
        tools: [HelperToolDefinition]
    ) throws -> GenerationSchema {
        let responseTypeSchema = DynamicGenerationSchema(
            name: "ResponseType",
            description: "Choose 'tool_call' when you need a gateway tool, especially if the user explicitly told you to use one. Choose 'final' only when no tool execution is needed.",
            anyOf: ["final", "tool_call"]
        )
        let summarizedTools = Array(tools.prefix(40))
        let listedToolNames = summarizedTools
            .map(\.name)
            .joined(separator: "; ")
        let remainingToolCount = max(0, tools.count - summarizedTools.count)
        let toolDescriptions = remainingToolCount > 0
            ? "\(listedToolNames); plus \(remainingToolCount) more tools not listed in this schema summary."
            : listedToolNames
        let root = DynamicGenerationSchema(
            name: "GatewayAppleResponse",
            description: toolDescriptions.isEmpty
                ? "Structured response for the Spaces gateway. Use type='tool_call' plus name and argumentsJSON when calling a tool. Use type='final' plus content for a normal answer."
                : "Structured response for the Spaces gateway. Use type='tool_call' plus name and argumentsJSON when calling a tool. Use type='final' plus content for a normal answer. Available tools: \(toolDescriptions)",
            properties: [
                DynamicGenerationSchema.Property(
                    name: "type",
                    schema: DynamicGenerationSchema(referenceTo: "ResponseType")
                ),
                DynamicGenerationSchema.Property(
                    name: "content",
                    schema: DynamicGenerationSchema(type: String.self, guides: [])
                ),
                DynamicGenerationSchema.Property(
                    name: "name",
                    schema: DynamicGenerationSchema(type: String.self, guides: [])
                ),
                DynamicGenerationSchema.Property(
                    name: "argumentsJSON",
                    schema: DynamicGenerationSchema(type: String.self, guides: [])
                ),
            ]
        )
        return try GenerationSchema(
            root: root,
            dependencies: [responseTypeSchema]
        )
    }

    private static func decodeStructuredResponse(from content: GeneratedContent) throws -> StructuredGatewayResponse {
        let data = Data(content.jsonString.utf8)
        return try JSONDecoder().decode(StructuredGatewayResponse.self, from: data)
    }

    private static func parseArguments(_ raw: String?) -> JSONValue {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              parsed is [String: Any] else {
            return .object([:])
        }
        return JSONValue(any: parsed)
    }

    private static func renderInstructions(from messages: [HelperMessage]) -> String {
        messages
            .filter { $0.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "system" }
            .map(\.content)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    private static func renderPrompt(from messages: [HelperMessage]) -> String {
        let body = messages
            .filter { $0.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "system" }
            .map(renderPromptLine(for:))
            .joined(separator: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if body.isEmpty {
            return "Respond to the latest request."
        }
        return """
        Continue the conversation below. Use the prior messages and tool results as context.

        \(body)
        """
    }

    private static func renderPromptLine(for message: HelperMessage) -> String {
        let role = message.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch role {
        case "user":
            return "User: \(message.content)"
        case "assistant":
            return "Assistant: \(message.content)"
        case "tool":
            let toolName = message.toolName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let label = (toolName?.isEmpty == false ? toolName! : "tool")
            return "Tool[\(label)]: \(message.content)"
        default:
            return "\(message.role): \(message.content)"
        }
    }

    private static func estimateUsage(messages: [HelperMessage], output: String) -> HelperUsage {
        let promptChars = messages.reduce(0) { partialResult, message in
            partialResult + message.content.count
        }
        let promptTokens = Int(ceil(Double(promptChars) / 4.0))
        let completionTokens = Int(ceil(Double(output.count) / 4.0))
        return HelperUsage(
            promptTokens: promptTokens,
            completionTokens: completionTokens,
            totalTokens: promptTokens + completionTokens,
            tokenAccuracy: "estimated",
            usageSource: "ledger"
        )
    }

    private static func decodeRequest() throws -> HelperRequest {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard !data.isEmpty else {
            throw HelperError("Expected JSON request on stdin.")
        }
        return try JSONDecoder().decode(HelperRequest.self, from: data)
    }

    private static func writeResponse(_ response: HelperResponse) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let data = try encoder.encode(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

struct HelperError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? {
        message
    }
}
