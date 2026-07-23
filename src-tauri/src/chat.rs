use crate::secrets::get_secret;
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, State};

const PROVIDER_ID: &str = "openai-compatible";
const MAX_MESSAGES: usize = 100;
const MAX_CONTENT_CHARS: usize = 100_000;

#[derive(Clone, Default)]
pub struct ChatManager {
    active: Arc<Mutex<HashMap<String, AbortHandle>>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    role: ChatRole,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ProviderToolCall>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProviderToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    function: ProviderFunctionCall,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProviderFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStartRequest {
    request_id: String,
    endpoint: String,
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    tools: Option<Vec<serde_json::Value>>,
    timeout_ms: u64,
    max_retries: u8,
    allow_insecure_http: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatError {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl ChatError {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatStreamEvent {
    request_id: String,
    event_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ProviderToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ChatError>,
}

impl ChatStreamEvent {
    fn delta(request_id: &str, delta: String) -> Self {
        Self {
            request_id: request_id.to_string(),
            event_type: "delta",
            delta: Some(delta),
            tool_calls: None,
            error: None,
        }
    }

    fn done(request_id: &str, tool_calls: Vec<ProviderToolCall>) -> Self {
        Self {
            request_id: request_id.to_string(),
            event_type: "done",
            delta: None,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            error: None,
        }
    }

    fn error(request_id: &str, error: ChatError) -> Self {
        Self {
            request_id: request_id.to_string(),
            event_type: "error",
            delta: None,
            tool_calls: None,
            error: Some(error),
        }
    }
}

fn validate_endpoint(endpoint: &str, allow_insecure_http: bool) -> Result<Url, ChatError> {
    let url = Url::parse(endpoint)
        .map_err(|_| ChatError::new("invalid_configuration", "模型接口地址不是合法 URL", false))?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() == "http" && !local_http && !allow_insecure_http {
        return Err(ChatError::new(
            "invalid_configuration",
            "HTTP 明文接口尚未授权；请在设置中显式开启临时 HTTP 测试",
            false,
        ));
    }
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(ChatError::new(
            "invalid_configuration",
            "模型接口只支持 HTTP 或 HTTPS",
            false,
        ));
    }
    Ok(url)
}

fn validate_request(request: &ChatStartRequest) -> Result<Url, ChatError> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err(ChatError::new("invalid_request", "请求 ID 不合法", false));
    }
    if request.model.trim().is_empty() || request.model.len() > 128 {
        return Err(ChatError::new(
            "invalid_configuration",
            "模型名称不能为空且不能超过 128 个字符",
            false,
        ));
    }
    if request.messages.is_empty() || request.messages.len() > MAX_MESSAGES {
        return Err(ChatError::new(
            "invalid_request",
            "上下文消息数量超出限制",
            false,
        ));
    }
    let total_chars = request
        .messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum::<usize>();
    if total_chars == 0 || total_chars > MAX_CONTENT_CHARS {
        return Err(ChatError::new(
            "invalid_request",
            "上下文内容为空或超出原生层上限",
            false,
        ));
    }
    if !(3_000..=120_000).contains(&request.timeout_ms) || request.max_retries > 2 {
        return Err(ChatError::new(
            "invalid_configuration",
            "超时或重试设置超出安全范围",
            false,
        ));
    }
    if let Some(tools) = &request.tools {
        if tools.len() > 16 {
            return Err(ChatError::new(
                "invalid_request",
                "工具数量超出本地上限",
                false,
            ));
        }
        let serialized = serde_json::to_string(tools)
            .map_err(|_| ChatError::new("invalid_request", "工具定义无法序列化", false))?;
        if serialized.len() > 32_768 {
            return Err(ChatError::new(
                "invalid_request",
                "工具定义体积超出原生层上限",
                false,
            ));
        }
        if tools.iter().any(|tool| !is_allowed_tool(tool)) {
            return Err(ChatError::new(
                "invalid_request",
                "工具定义包含不在 M12 白名单内的名称",
                false,
            ));
        }
    }
    validate_endpoint(&request.endpoint, request.allow_insecure_http)
}

fn is_allowed_tool(tool: &serde_json::Value) -> bool {
    matches!(
        tool.pointer("/function/name")
            .and_then(serde_json::Value::as_str),
        Some(
            "pet_play_motion"
                | "pet_set_expression"
                | "pet_set_look"
                | "pet_move_window"
                | "pet_say"
                | "memory_propose"
                | "timer_start"
                | "timer_pause"
                | "timer_resume"
                | "timer_cancel"
        )
    )
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

enum DecodedEvent {
    Delta(String),
    ToolCallDelta(ToolCallDelta),
    Done,
}

#[derive(Debug)]
struct ToolCallDelta {
    index: usize,
    id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<DecodedEvent>, ChatError> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() || line.first() == Some(&b':') {
                continue;
            }
            let text = std::str::from_utf8(&line)
                .map_err(|_| ChatError::new("invalid_response", "模型流包含无效 UTF-8", false))?;
            let Some(data) = text.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim_start();
            if data == "[DONE]" {
                events.push(DecodedEvent::Done);
                continue;
            }
            let value: serde_json::Value = serde_json::from_str(data).map_err(|_| {
                ChatError::new("invalid_response", "模型返回了无效的流式 JSON", false)
            })?;
            if let Some(delta) = value
                .pointer("/choices/0/delta/content")
                .and_then(serde_json::Value::as_str)
            {
                if !delta.is_empty() {
                    events.push(DecodedEvent::Delta(delta.to_string()));
                }
            }
            if let Some(tool_calls) = value
                .pointer("/choices/0/delta/tool_calls")
                .and_then(serde_json::Value::as_array)
            {
                for call in tool_calls {
                    let Some(index) = call.get("index").and_then(serde_json::Value::as_u64) else {
                        return Err(ChatError::new(
                            "invalid_response",
                            "模型工具调用缺少有效 index",
                            false,
                        ));
                    };
                    events.push(DecodedEvent::ToolCallDelta(ToolCallDelta {
                        index: index as usize,
                        id: call
                            .get("id")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                        name: call
                            .pointer("/function/name")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                        arguments: call
                            .pointer("/function/arguments")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    }));
                }
            }
        }
        Ok(events)
    }
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct ChatCompletion {
    tool_calls: Vec<ProviderToolCall>,
}

struct AttemptFailure {
    error: ChatError,
    emitted_delta: bool,
}

async fn stream_once(
    app: &tauri::AppHandle,
    window_label: &str,
    request: &ChatStartRequest,
    endpoint: Url,
    api_key: Option<&str>,
) -> Result<ChatCompletion, AttemptFailure> {
    let client = Client::builder()
        .timeout(Duration::from_millis(request.timeout_ms))
        .build()
        .map_err(|error| AttemptFailure {
            error: ChatError::new(
                "network_error",
                format!("创建网络客户端失败：{error}"),
                true,
            ),
            emitted_delta: false,
        })?;
    let mut body = json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true
    });
    if let Some(tools) = &request.tools {
        body["tools"] = json!(tools);
        body["tool_choice"] = json!("auto");
    }
    let mut request_builder = client.post(endpoint).json(&body);
    if let Some(api_key) = api_key {
        request_builder = request_builder.bearer_auth(api_key);
    }
    let response = request_builder
        .send()
        .await
        .map_err(|error| AttemptFailure {
            error: if error.is_timeout() {
                ChatError::new("timeout", "模型请求超时", true)
            } else {
                ChatError::new("network_error", format!("模型网络请求失败：{error}"), true)
            },
            emitted_delta: false,
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error = match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                ChatError::new("invalid_api_key", "API key 无效或没有访问权限", false)
            }
            StatusCode::TOO_MANY_REQUESTS => {
                ChatError::new("rate_limited", "模型服务正在限流，请稍后重试", true)
            }
            status if status.is_server_error() => ChatError::new(
                "provider_unavailable",
                format!("模型服务暂时不可用（HTTP {status}）"),
                true,
            ),
            _ => ChatError::new(
                "provider_error",
                format!("模型服务拒绝了请求（HTTP {status}）"),
                false,
            ),
        };
        return Err(AttemptFailure {
            error,
            emitted_delta: false,
        });
    }

    let mut stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut emitted_delta = false;
    let mut tool_calls = BTreeMap::<usize, ToolCallAccumulator>::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| AttemptFailure {
            error: if error.is_timeout() {
                ChatError::new("timeout", "接收模型响应超时", true)
            } else {
                ChatError::new("network_error", format!("模型响应中断：{error}"), true)
            },
            emitted_delta,
        })?;
        for event in decoder.push(&chunk).map_err(|error| AttemptFailure {
            error,
            emitted_delta,
        })? {
            match event {
                DecodedEvent::Delta(delta) => {
                    emitted_delta = true;
                    let _ = app.emit_to(
                        window_label,
                        "chat-stream",
                        ChatStreamEvent::delta(&request.request_id, delta),
                    );
                }
                DecodedEvent::ToolCallDelta(delta) => {
                    let call = tool_calls.entry(delta.index).or_default();
                    if let Some(id) = delta.id {
                        call.id.push_str(&id);
                    }
                    if let Some(name) = delta.name {
                        call.name.push_str(&name);
                    }
                    if let Some(arguments) = delta.arguments {
                        call.arguments.push_str(&arguments);
                    }
                }
                DecodedEvent::Done => {
                    return finalize_completion(tool_calls).map_err(|error| AttemptFailure {
                        error,
                        emitted_delta,
                    })
                }
            }
        }
    }

    if emitted_delta || !tool_calls.is_empty() {
        finalize_completion(tool_calls).map_err(|error| AttemptFailure {
            error,
            emitted_delta,
        })
    } else {
        Err(AttemptFailure {
            error: ChatError::new("invalid_response", "模型没有返回文本内容", false),
            emitted_delta: false,
        })
    }
}

fn finalize_completion(
    calls: BTreeMap<usize, ToolCallAccumulator>,
) -> Result<ChatCompletion, ChatError> {
    let mut result = Vec::with_capacity(calls.len());
    for (_, call) in calls {
        if call.id.is_empty() || call.name.is_empty() {
            return Err(ChatError::new(
                "invalid_response",
                "模型返回了不完整的工具调用",
                false,
            ));
        }
        result.push(ProviderToolCall {
            id: call.id,
            kind: "function".to_string(),
            function: ProviderFunctionCall {
                name: call.name,
                arguments: call.arguments,
            },
        });
    }
    Ok(ChatCompletion { tool_calls: result })
}

async fn run_chat(
    app: tauri::AppHandle,
    window_label: String,
    request: ChatStartRequest,
    endpoint: Url,
    api_key: Option<String>,
) -> Result<ChatCompletion, ChatError> {
    let mut attempt = 0u8;
    loop {
        match stream_once(
            &app,
            &window_label,
            &request,
            endpoint.clone(),
            api_key.as_deref(),
        )
        .await
        {
            Ok(completion) => return Ok(completion),
            Err(failure)
                if failure.error.retryable
                    && !failure.emitted_delta
                    && attempt < request.max_retries =>
            {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(350 * u64::from(attempt))).await;
            }
            Err(failure) => return Err(failure.error),
        }
    }
}

#[tauri::command]
pub fn chat_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    manager: State<'_, ChatManager>,
    request: ChatStartRequest,
) -> Result<(), ChatError> {
    let endpoint = validate_request(&request)?;
    let api_key = get_secret(&app, PROVIDER_ID)
        .map_err(|error| ChatError::new("secret_store_error", error, false))?;
    let mut active = manager
        .active
        .lock()
        .map_err(|_| ChatError::new("internal_error", "对话请求状态不可用", false))?;
    if active.contains_key(&request.request_id) {
        return Err(ChatError::new(
            "request_conflict",
            "相同请求 ID 已在运行",
            false,
        ));
    }
    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    active.insert(request.request_id.clone(), abort_handle);
    drop(active);

    let request_id = request.request_id.clone();
    let window_label = window.label().to_string();
    let manager = manager.inner().clone();
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = Abortable::new(
            run_chat(
                task_app.clone(),
                window_label.clone(),
                request,
                endpoint,
                api_key,
            ),
            abort_registration,
        )
        .await;
        if let Ok(mut active) = manager.active.lock() {
            active.remove(&request_id);
        }
        match result {
            Ok(Ok(completion)) => {
                let _ = task_app.emit_to(
                    &window_label,
                    "chat-stream",
                    ChatStreamEvent::done(&request_id, completion.tool_calls),
                );
            }
            Ok(Err(error)) => {
                let _ = task_app.emit_to(
                    &window_label,
                    "chat-stream",
                    ChatStreamEvent::error(&request_id, error),
                );
            }
            Err(_) => {
                let _ = task_app.emit_to(
                    &window_label,
                    "chat-stream",
                    ChatStreamEvent::error(
                        &request_id,
                        ChatError::new("cancelled", "已停止生成", false),
                    ),
                );
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn chat_cancel(manager: State<'_, ChatManager>, request_id: String) -> Result<bool, String> {
    let active = manager
        .active
        .lock()
        .map_err(|_| "对话请求状态不可用".to_string())?;
    if let Some(handle) = active.get(&request_id) {
        handle.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_tool, validate_endpoint, DecodedEvent, SseDecoder};
    use serde_json::json;

    #[test]
    fn endpoint_requires_https_except_localhost() {
        assert!(validate_endpoint("https://api.example.com/v1/chat/completions", false).is_ok());
        assert!(validate_endpoint("http://localhost:11434/v1/chat/completions", false).is_ok());
        assert!(validate_endpoint("http://127.0.0.1:8080/chat", false).is_ok());
        assert!(validate_endpoint("http://26.70.113.57:11434/v1/chat/completions", false).is_err());
        assert!(validate_endpoint("http://26.70.113.57:11434/v1/chat/completions", true).is_ok());
        assert!(validate_endpoint("ftp://example.com/chat", true).is_err());
        assert!(validate_endpoint("not a url", true).is_err());
    }

    #[test]
    fn sse_decoder_handles_split_utf8_and_done() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n";
        let bytes = line.as_bytes();
        let split = bytes
            .windows(3)
            .position(|window| window == "你".as_bytes())
            .expect("Chinese bytes")
            + 1;
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(&bytes[..split]).expect("first").is_empty());
        let events = decoder.push(&bytes[split..]).expect("second");
        assert!(matches!(&events[0], DecodedEvent::Delta(text) if text == "你好"));
        let done = decoder.push(b"data: [DONE]\n\n").expect("done");
        assert!(matches!(done[0], DecodedEvent::Done));
    }

    #[test]
    fn sse_decoder_rejects_invalid_json() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: nope\n").is_err());
    }

    #[test]
    fn sse_decoder_preserves_fragmented_tool_calls() {
        let mut decoder = SseDecoder::default();
        let first = decoder
            .push(concat!(r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"pet_play_","arguments":"{\"motion\":"}}]}}]}"#, "\n").as_bytes())
            .expect("first tool delta");
        let second = decoder
            .push(concat!(r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"motion","arguments":"\"wave\"}"}}]}}]}"#, "\n").as_bytes())
            .expect("second tool delta");
        assert!(matches!(
            &first[0],
            DecodedEvent::ToolCallDelta(delta)
                if delta.index == 0
                    && delta.id.as_deref() == Some("call_1")
                    && delta.name.as_deref() == Some("pet_play_")
        ));
        assert!(matches!(
            &second[0],
            DecodedEvent::ToolCallDelta(delta)
                if delta.name.as_deref() == Some("motion")
                    && delta.arguments.as_deref() == Some("\"wave\"}")
        ));
    }

    #[test]
    fn rust_boundary_rejects_non_whitelisted_tools() {
        assert!(is_allowed_tool(&json!({
            "type": "function",
            "function": { "name": "pet_play_motion" }
        })));
        assert!(is_allowed_tool(&json!({
            "type": "function",
            "function": { "name": "pet_say" }
        })));
        assert!(is_allowed_tool(&json!({
            "type": "function",
            "function": { "name": "memory_propose" }
        })));
        assert!(!is_allowed_tool(&json!({
            "type": "function",
            "function": { "name": "run_shell" }
        })));
    }
}
