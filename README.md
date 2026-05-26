# Connect Desk 🖥️✨

O **Connect Desk** é um software de suporte e controle remoto de alto desempenho baseado em tecnologias modernas de web e APIs nativas do Windows. Ele permite que você visualize e controle computadores remotamente em tempo real diretamente pelo seu navegador, sem a necessidade de instalar clientes pesados no lado do visualizador.

Com um design premium de última geração — utilizando dark mode, glassmorphism e efeitos fluidos —, o Connect Desk combina facilidade de uso com excelente performance.

---

## 🚀 Funcionalidades Principais

- **Captura Ultra-Rápida de Tela:** Motor de captura nativo escrito em C# e executado dinamicamente via PowerShell em segundo plano (GDI+), garantindo alta taxa de quadros e excelente nitidez para leitura de textos.
- **Controle Interativo Completo:** 
  - **Mouse:** Movimentação, cliques (esquerdo e direito) e rolagem (*scroll*).
  - **Teclado:** Envio de texto e teclas especiais (Enter, Backspace, Tab, Setas direcionais, Delete, etc.).
- **Painel de Controle Web Responsivo:** Interface web incrível baseada em fontes modernas (Outfit e Inter) com controle dinâmico de zoom/escala ("Ajustar à tela" ou "1:1 Real").
- **Conectividade Segura por Sessão:** Cada máquina de destino recebe um endereço exclusivo de 9 dígitos formatado e uma senha temporária aleatória de 4 dígitos gerada a cada inicialização do cliente.
- **Servidor Web Coordenador Embutido:** O próprio cliente consegue inicializar um painel web local na porta `4500` caso esteja em rede local, permitindo controle direto.
- **Empacotamento Standalone:** O cliente pode ser compilado em um único arquivo executável `.exe` de clique único usando a ferramenta `pkg`.
- **Solução Inteligente para VPS Windows:** Integração nativa de instruções e alertas para evitar o travamento de tela/tela preta comum ao minimizar ou desconectar sessões RDP em servidores virtuais.

---

## 🛠️ Arquitetura do Projeto

O projeto é dividido em duas partes principais:

1. **`server/` (Servidor Coordenador):**
   - Baseado em **Node.js**, **Express** e **Socket.io**.
   - Atua como um intermediário leve e de baixa latência que apenas redireciona os comandos de mouse/teclado dos visualizadores para a máquina alvo, e redistribui os frames de vídeo da máquina alvo para os visualizadores.
   
2. **`client/` (Cliente Host / Máquina Alvo):**
   - Um aplicativo **Node.js** que inicia um processo persistente e otimizado do PowerShell.
   - O script do PowerShell carrega dinamicamente código C# nativo para interagir diretamente com as APIs do Windows (GDI+, `user32.dll` para movimentos de mouse e teclado).
   - Envia os frames de tela como JPEG comprimido em qualidade de alta fidelidade via conexões de WebSocket (Socket.io).

---

## 📋 Pré-requisitos

* **Servidor Coordenador:** Qualquer sistema operacional (Windows, Linux, macOS) com **Node.js v16+** instalado.
* **Cliente (Máquina a ser controlada):** Sistema Operacional **Windows** (devido ao uso de APIs nativas Win32 e GDI+) com **Node.js v16+** instalado.
* **Visualizador (Viewer):** Qualquer dispositivo moderno com um navegador web atualizado (Chrome, Edge, Firefox, Safari).

---

## ⚙️ Instalação e Execução

### Passo 1: Instalação das Dependências

Primeiramente, baixe ou extraia o projeto. No terminal do diretório raiz, instale as dependências gerais do projeto e do servidor:

```bash
npm install
```

Em seguida, navegue até a pasta `client/` e instale as dependências específicas do cliente remoto:

```bash
cd client
npm install
cd ..
```

---

### Passo 2: Inicializar o Servidor Coordenador

Inicie o servidor de conexão para que as máquinas possam se registrar e se comunicar. Por padrão, ele escutará na porta `4500`:

```bash
node server/server.js
```

Você verá a seguinte saída no terminal:
> `Server (Controller) running at http://localhost:4500`

*Nota: Se você for implantar o servidor em uma VPS ou nuvem, certifique-se de expor a porta `4500` (ou a porta configurada na variável de ambiente `PORT`) em seu firewall.*

---

### Passo 3: Configurar e Inicializar o Cliente

No computador que você deseja controlar:

1. Verifique as configurações no arquivo `client/config.json`:
   ```json
   {
     "id": "411988342",
     "serverUrl": "http://localhost:4500"
   }
   ```
   *Substitua `http://localhost:4500` pelo IP público ou domínio do seu servidor coordenador, se ele não estiver rodando localmente.*

2. Inicialize o cliente:
   ```bash
   node client/client.js
   ```

3. O console do cliente limpará a tela e exibirá as credenciais de conexão seguras formatadas:

   ```text
   ==================================================
         CONNECT DESK REMOTE CONTROL CLIENT (PoC)    
   ==================================================
     Endereço Remoto:      123 456 789
     Senha Temporária:     4321
   ==================================================
     Conectando ao Coordenador: http://localhost:4500
   ==================================================
     ► SE DETECTAR TELA PRETA EM VPS WINDOWS:
       Caso sua sessão RDP caia ou seja fechada, a GUI trava.
       Para desconectar mantendo a tela ativa, rode no cmd:
       tscon 1 /dest:console (troque 1 pelo ID da query session)
   ==================================================
     ► PARA CONTROLAR OUTRO COMPUTADOR:
       Pressione [Enter] para abrir o Painel de Controle
   ==================================================
   ```

---

### Passo 4: Realizar o Controle Remoto

1. No computador do suporte (Visualizador), abra o navegador e acesse o endereço do servidor coordenador (ex: `http://localhost:4500` ou o endereço IP público/domínio da sua VPS).
2. Na belíssima tela inicial do **Connect Desk**, insira o **Endereço Remoto** de 9 dígitos exibido no console do cliente.
3. Clique em **Iniciar Conexão**.
4. Uma janela pop-up estilizada solicitará a senha. Digite a **Senha Temporária** de 4 dígitos gerada no console da máquina alvo e clique em **Confirmar**.
5. **Pronto!** A tela da máquina remota será renderizada de forma ultra fluida. Use o mouse e o teclado para operá-la como se estivesse na frente dela.

---

## 📦 Compilando para Executável Standalone (`.exe`)

Para facilitar o uso por parte de clientes ou usuários de suporte final, você pode compilar o módulo `client` em um único arquivo executável para Windows. Isso elimina a necessidade de instalar o Node.js na máquina que será controlada!

Para fazer isso:
1. Abra um terminal na pasta `client/`:
   ```bash
   cd client
   ```
2. Execute o comando de compilação:
   ```bash
   npm run build
   ```
3. A ferramenta `pkg` irá empacotar todos os scripts, dependências do node_modules e arquivos estáticos da pasta `public` no executável.
4. O arquivo gerado estará disponível em `client/dist/connectdesk.exe`.

Agora você pode enviar este arquivo diretamente para o usuário. Ele só precisa dar um duplo clique no executável para gerar as credenciais de suporte instantâneo!

---

## 💡 Dica Especial para VPS Windows (GUI Inativa / Tela Preta)

Ao utilizar o controle remoto em VPSs Windows (como as contratadas na AWS, Azure, Google Cloud ou provedores locais), é comum se deparar com uma tela preta se você fechar ou minimizar a janela de Conexão de Área de Trabalho Remota (RDP) padrão do Windows. Isso ocorre porque o Windows desativa o renderizador GUI de tela ativa para economizar recursos quando não há nenhum usuário RDP ativo.

Para solucionar isso e manter a tela ativa para o **Connect Desk** continuar funcionando perfeitamente, siga estas etapas antes de fechar o seu RDP:

1. Abra o **Prompt de Comando (CMD)** como **Administrador** na sua VPS.
2. Execute o seguinte comando para obter o ID da sua sessão RDP ativa:
   ```cmd
   query session
   ```
3. Você verá uma lista. Procure pela linha com o nome do seu usuário (normalmente `Administrator` ou `Administrador`) sob a sessão com nome ativo `rdp-tcp#...` e anote o número exibido na coluna **ID** (geralmente é `1` ou `2`).
4. Execute o comando a seguir substituindo o `ID_DA_SESSAO` pelo número anotado:
   ```cmd
   tscon ID_DA_SESSAO /dest:console
   ```
   *Exemplo:* `tscon 1 /dest:console`
5. A sua janela do RDP padrão será fechada imediatamente. Porém, o Windows irá transferir a interface gráfica ativa diretamente para o console local, mantendo a GUI em execução ativa.
6. Agora, o **Connect Desk** poderá transmitir a tela e aceitar comandos de mouse e teclado sem nenhum travamento ou tela preta!

---

## 🎨 Design Premium e Personalização

O Connect Desk foi desenvolvido sob os mais rígidos padrões de design moderno para proporcionar a melhor experiência do usuário:
- **Tipografia Fluida:** Utilização das fontes Outfit e Inter via Google Fonts.
- **Aparência Premium Glass:** Efeitos de desfoque de fundo (*backdrop-filter*) e gradientes elegantes que acompanham as interações.
- **Responsividade Dinâmica:** O visualizador é compatível tanto com monitores ultrawide quanto com notebooks e telas menores, graças à capacidade inteligente de ajuste e redimensionamento automático do canvas.

---

## 📄 Licença

Este projeto é desenvolvido para fins educacionais e de demonstração de conceito (PoC). Sinta-se livre para customizar, expandir e integrar em suas próprias soluções de suporte de TI!
