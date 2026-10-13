fn main() {
    // A interface vem do servidor em http://localhost, que o Tauri trata como
    // conteúdo remoto: sem um manifesto com os comandos do app e uma permissão
    // explícita na capability, todo `invoke` dela é recusado ("not allowed by
    // ACL"). Foi isso que fez o "Atualizar" falhar logo depois de baixar.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["reiniciar", "parar_servidor_para_atualizar"]),
    ))
    .expect("falha ao gerar o contexto do Tauri");
}
