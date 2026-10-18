// Casca desktop do Astroflix. O app de verdade continua sendo o servidor Node
// (server/), empacotado como sidecar: esta casca sobe o servidor, espera ele
// dizer em que URL ficou e carrega a interface dele na janela.
//
// Em `pnpm dev` (tauri dev) não há sidecar: o servidor roda pelo tsx e a janela
// abre o Vite (devUrl em tauri.dev.conf.json), com hot reload.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Url, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Quanto esperar o servidor dizer a URL antes de mostrar o erro.
const ESPERA_MAXIMA: Duration = Duration::from_secs(20);

/// O processo atual e a geração dele. Cada subida ganha uma geração nova: os
/// eventos de um processo antigo (morto pelo "Tentar de novo") não podem mais
/// mexer na janela — senão o "servidor parou" do velho taparia o app novo.
#[derive(Default)]
struct Sidecar {
    filho: Mutex<Option<CommandChild>>,
    geracao: AtomicU64,
}

/// "Baixar para Downloads" em andamento (o servidor avisa com LEARNFLIX_BAIXANDO=).
/// Um curso do Telegram leva horas: fechar a janela não pode parar o download,
/// e o sistema não pode dormir nem pôr o app em App Nap no meio dele.
#[derive(Default)]
struct Segundoplano {
    baixando: AtomicBool,
    /// A pessoa fechou a janela durante o download: o app sai quando ele acabar.
    janela_fechada: AtomicBool,
}

/// Segura (ou solta) o sistema acordado. Roda na thread principal: a atividade
/// do macOS e o estado de energia do Windows pertencem à thread que os pediu.
fn manter_acordado(app: &AppHandle, ligar: bool) {
    let _ = app.run_on_main_thread(move || energia::manter_acordado(ligar));
}

#[cfg(target_os = "macos")]
mod energia {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};

    thread_local! {
        static ATIVIDADE: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(None) };
    }

    // UserInitiated: sem App Nap (que atrasa os timers e a rede do app escondido)
    // e sem o descanso automático do sistema. A tela ainda pode apagar.
    pub fn manter_acordado(ligar: bool) {
        ATIVIDADE.with(|atividade| {
            let mut atividade = atividade.borrow_mut();
            let info = NSProcessInfo::processInfo();
            if ligar && atividade.is_none() {
                let motivo = NSString::from_str("Baixando cursos para a pasta Downloads");
                *atividade = Some(info.beginActivityWithOptions_reason(NSActivityOptions::UserInitiated, &motivo));
            } else if !ligar {
                if let Some(a) = atividade.take() {
                    unsafe { info.endActivity(&a) };
                }
            }
        });
    }
}

#[cfg(windows)]
mod energia {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};

    pub fn manter_acordado(ligar: bool) {
        let estado = if ligar { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
        unsafe { SetThreadExecutionState(estado) };
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod energia {
    pub fn manter_acordado(_ligar: bool) {}
}

fn mudou_download(app: &AppHandle, baixando: bool) {
    let estado = app.state::<Segundoplano>();
    if estado.baixando.swap(baixando, Ordering::SeqCst) == baixando {
        return;
    }
    manter_acordado(app, baixando);
    // A janela foi fechada só para esperar o download: acabou, o app sai.
    if !baixando && estado.janela_fechada.load(Ordering::SeqCst) {
        app.exit(0);
    }
}

fn mostrar_janela(app: &AppHandle) {
    app.state::<Segundoplano>().janela_fechada.store(false, Ordering::SeqCst);
    if let Some(janela) = app.get_webview_window("main") {
        let _ = janela.unminimize();
        let _ = janela.show();
        let _ = janela.set_focus();
    }
}

fn atual(app: &AppHandle, geracao: u64) -> bool {
    app.state::<Sidecar>().geracao.load(Ordering::SeqCst) == geracao
}

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
    let estado = app.state::<Sidecar>();
    // Antes do kill: o Terminated que vem a seguir já é de uma geração vencida.
    estado.geracao.fetch_add(1, Ordering::SeqCst);
    let filho = estado.filho.lock().unwrap().take();
    if let Some(filho) = filho {
        let _ = filho.kill();
    }
}

fn subir_servidor(app: &AppHandle) {
    parar_servidor(app);

    let comando = match app.shell().sidecar("learnflix-server") {
        Ok(c) => c,
        Err(e) => return mostrar_erro(app, &format!("servidor não encontrado: {e}")),
    };
    let (mut eventos, filho) = match comando.spawn() {
        Ok(par) => par,
        Err(e) => return mostrar_erro(app, &format!("não foi possível iniciar o servidor: {e}")),
    };
    let estado = app.state::<Sidecar>();
    let geracao = estado.geracao.load(Ordering::SeqCst);
    *estado.filho.lock().unwrap() = Some(filho);

    let pronto = Arc::new(AtomicBool::new(false));

    // Prazo: se a URL não vier, a janela não pode ficar em "Abrindo…" para sempre.
    {
        let app = app.clone();
        let pronto = pronto.clone();
        // Thread própria: dormir dentro do runtime assíncrono prenderia um worker.
        std::thread::spawn(move || {
            std::thread::sleep(ESPERA_MAXIMA);
            if !pronto.load(Ordering::SeqCst) && atual(&app, geracao) {
                mostrar_erro(&app, "o servidor demorou demais para responder");
            }
        });
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Últimas linhas de erro: é o que explica uma falha de boot (porta, banco).
        let mut ultimas: Vec<String> = Vec::new();
        while let Some(evento) = eventos.recv().await {
            if !atual(&app, geracao) {
                break;
            }
            match evento {
                CommandEvent::Stdout(bytes) => {
                    let texto = String::from_utf8_lossy(&bytes).to_string();
                    for linha in texto.lines() {
                        if let Some(url) = linha.trim().strip_prefix("LEARNFLIX_URL=") {
                            if let Ok(url) = Url::parse(url) {
                                pronto.store(true, Ordering::SeqCst);
                                navegar(&app, url);
                            }
                        } else if let Some(valor) = linha.trim().strip_prefix("LEARNFLIX_BAIXANDO=") {
                            mudou_download(&app, valor == "1");
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
                    mudou_download(&app, false);
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

/// Chamado pela interface antes de instalar uma atualização. No Windows o
/// instalador encerra o app com exit direto, sem RunEvent::Exit: se o servidor
/// continuasse vivo, ele seguraria o .exe e o instalador não conseguiria trocá-lo.
#[tauri::command]
fn parar_servidor_para_atualizar(app: AppHandle) {
    parar_servidor(&app);
}

/// O app se chamava Learnflix. A atualização troca o conteúdo do pacote mas mantém
/// o caminho, então quem instalou antes da troca de nome continuava vendo
/// "Learnflix.app" no Finder e no Dock. Na primeira abertura depois disso, o pacote
/// se renomeia para Astroflix.app e reabre por lá (o atualizador usa o caminho do
/// executável; sem reabrir, a próxima atualização recriaria o nome antigo).
/// Devolve true quando renomeou e o processo deve sair.
#[cfg(target_os = "macos")]
fn renomear_pacote_antigo() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    // .../Learnflix.app/Contents/MacOS/learnflix
    let Some(pacote) = exe.ancestors().nth(3) else { return false };
    if pacote.file_name().and_then(|n| n.to_str()) != Some("Learnflix.app") {
        return false;
    }
    let Some(pasta) = pacote.parent() else { return false };
    let novo = pasta.join("Astroflix.app");
    // Já existe um Astroflix.app ali (instalado à mão): não mexe em nada.
    if novo.exists() || std::fs::rename(pacote, &novo).is_err() {
        return false;
    }
    // Reabre depois que este processo sair: a instância única recusaria as duas juntas.
    let reabrir = format!("sleep 1; open \"{}\"", novo.display());
    std::process::Command::new("/bin/sh").arg("-c").arg(reabrir).spawn().is_ok()
}

pub fn run() {
    #[cfg(target_os = "macos")]
    if !tauri::is_dev() && renomear_pacote_antigo() {
        std::process::exit(0);
    }
    tauri::Builder::default()
        // Primeiro: uma segunda abertura só traz a janela existente para a frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar_janela(app)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar::default())
        .manage(Segundoplano::default())
        .on_window_event(|janela, evento| {
            // Fechar a janela no meio de um download só a esconde (no macOS; nos
            // outros, minimiza: sem ícone na bandeja, escondida ninguém a acharia).
            // Cmd+Q / sair do menu continua encerrando: o download retoma ao abrir.
            if let WindowEvent::CloseRequested { api, .. } = evento {
                let app = janela.app_handle();
                let estado = app.state::<Segundoplano>();
                if estado.baixando.load(Ordering::SeqCst) {
                    api.prevent_close();
                    estado.janela_fechada.store(true, Ordering::SeqCst);
                    if cfg!(target_os = "macos") {
                        let _ = janela.hide();
                    } else {
                        let _ = janela.minimize();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![reiniciar, parar_servidor_para_atualizar])
        .setup(|app| {
            if !tauri::is_dev() {
                subir_servidor(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("falha ao montar o app")
        .run(|app, evento| {
            // Fechar o app não pode deixar o servidor rodando sozinho.
            match evento {
                RunEvent::Exit => {
                    manter_acordado(app, false);
                    parar_servidor(app);
                }
                // Clique no ícone do Dock com a janela escondida pelo download.
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => mostrar_janela(app),
                _ => {}
            }
        });
}
