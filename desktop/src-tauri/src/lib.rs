// Casca desktop do Learnflix. O app de verdade continua sendo o servidor Node
// (server/), empacotado como sidecar: esta casca sobe o servidor, espera ele
// dizer em que URL ficou e carrega a interface dele na janela. Assim, telas,
// banco, Drive e progresso são exatamente os mesmos do modo navegador.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Quanto esperar o servidor dizer a URL antes de mostrar o erro.
const ESPERA_MAXIMA: Duration = Duration::from_secs(20);

#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

/// Endereço da página local (desktop/carregando). O esquema muda por plataforma.
fn pagina_local(hash: &str) -> Url {
    let base = if cfg!(windows) {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    };
    let mut url = Url::parse(base).expect("URL local válida");
    if !hash.is_empty() {
        url.set_fragment(Some(hash));
    }
    url
}

fn navegar(app: &AppHandle, url: Url) {
    if let Some(janela) = app.get_webview_window("main") {
        let _ = janela.navigate(url);
    }
}

fn mostrar_erro(app: &AppHandle, motivo: &str) {
    let mut url = pagina_local("");
    url.query_pairs_mut().append_pair("erro", motivo);
    navegar(app, url);
}

fn parar_servidor(app: &AppHandle) {
    if let Some(filho) = app.state::<Sidecar>().0.lock().unwrap().take() {
        let _ = filho.kill();
    }
}

fn subir_servidor(app: &AppHandle) {
    parar_servidor(app);

    let comando = match app.shell().sidecar("learnflix-server") {
        Ok(c) => c.env("LEARNFLIX_DESKTOP", "1"),
        Err(e) => return mostrar_erro(app, &format!("servidor não encontrado: {e}")),
    };
    let (mut eventos, filho) = match comando.spawn() {
        Ok(par) => par,
        Err(e) => return mostrar_erro(app, &format!("não foi possível iniciar o servidor: {e}")),
    };
    *app.state::<Sidecar>().0.lock().unwrap() = Some(filho);

    let pronto = Arc::new(AtomicBool::new(false));

    // Prazo: se a URL não vier, a janela não pode ficar em "Abrindo…" para sempre.
    {
        let app = app.clone();
        let pronto = pronto.clone();
        // Thread própria: dormir dentro do runtime assíncrono prenderia um worker.
        std::thread::spawn(move || {
            std::thread::sleep(ESPERA_MAXIMA);
            if !pronto.load(Ordering::SeqCst) {
                mostrar_erro(&app, "o servidor demorou demais para responder");
            }
        });
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Últimas linhas de erro: é o que explica uma falha de boot (porta, banco).
        let mut ultimas: Vec<String> = Vec::new();
        while let Some(evento) = eventos.recv().await {
            match evento {
                CommandEvent::Stdout(bytes) => {
                    let texto = String::from_utf8_lossy(&bytes).to_string();
                    for linha in texto.lines() {
                        if let Some(url) = linha.trim().strip_prefix("LEARNFLIX_URL=") {
                            if let Ok(url) = Url::parse(url) {
                                pronto.store(true, Ordering::SeqCst);
                                navegar(&app, url);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let texto = String::from_utf8_lossy(&bytes).to_string();
                    for linha in texto.lines().filter(|l| !l.trim().is_empty()) {
                        ultimas.push(linha.to_string());
                        if ultimas.len() > 5 {
                            ultimas.remove(0);
                        }
                    }
                }
                CommandEvent::Terminated(fim) => {
                    pronto.store(true, Ordering::SeqCst);
                    let detalhe = if ultimas.is_empty() {
                        format!("o servidor parou (código {:?})", fim.code)
                    } else {
                        ultimas.join("\n")
                    };
                    mostrar_erro(&app, &detalhe);
                    break;
                }
                _ => {}
            }
        }
    });
}

/// Chamado pelo botão "Tentar de novo" da página de erro.
#[tauri::command]
fn reiniciar(app: AppHandle) {
    navegar(&app, pagina_local(""));
    subir_servidor(&app);
}

pub fn run() {
    tauri::Builder::default()
        // Primeiro: uma segunda abertura só traz a janela existente para a frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(janela) = app.get_webview_window("main") {
                let _ = janela.unminimize();
                let _ = janela.show();
                let _ = janela.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![reiniciar])
        .setup(|app| {
            subir_servidor(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("falha ao montar o app")
        .run(|app, evento| {
            // Fechar o app não pode deixar o servidor rodando sozinho.
            if let RunEvent::Exit = evento {
                parar_servidor(app);
            }
        });
}
