(("undefined"!=typeof globalThis?globalThis:self)["makoChunk_server-ops-frontend"]=("undefined"!=typeof globalThis?globalThis:self)["makoChunk_server-ops-frontend"]||[]).push([["05793652"],{"1263ea82":function(e,n,t){t.d(n,"__esModule",{value:!0}),t.e(n,{default:function(){return ee;}});var l=t("777fffbe"),o=t("852bbaa9"),r=t("a9581d70"),a=t("1cd9cd14"),i=l._(a),d=t("b6ef6233"),s=l._(d),u=t("c85e2f74"),p=t("1506b523"),f=l._(p),c=t("9fcbb86d"),h=l._(c),g=t("ebd105f7"),x=t("e42491f3"),m=l._(x),v=t("ec43fb0b"),b=o._(v),j=t("ee1d285c"),P=t("34aa49c3"),y=l._(P),w=["options","fieldProps","proFieldProps","valueEnum"],T=b.default.forwardRef(function(e,n){var t=e.options,l=e.fieldProps,o=e.proFieldProps,a=e.valueEnum,i=(0,h.default)(e,w);return(0,r.jsx)(y.default,(0,f.default)({ref:n,valueType:"checkbox",valueEnum:(0,g.runFunction)(a,void 0),fieldProps:(0,f.default)({options:t},l),lightProps:(0,f.default)({labelFormatter:function(){return(0,r.jsx)(y.default,(0,f.default)({ref:n,valueType:"checkbox",mode:"read",valueEnum:(0,g.runFunction)(a,void 0),filedConfig:{customLightMode:!0},fieldProps:(0,f.default)({options:t},l),proFieldProps:o},i));}},i.lightProps),proFieldProps:o},i));}),C=b.default.forwardRef(function(e,n){var t=e.fieldProps,l=e.children;return(0,r.jsx)(m.default,(0,f.default)((0,f.default)({ref:n},t),{},{children:l}));}),F=(0,j.createField)(C,{valuePropName:"checked"});F.Group=T;var _=t("1c406065"),k=l._(_),N=t("69f0fabd"),S=t("626a03fb"),B=l._(S),R=t("57ea0323"),L=l._(R),M=t("1b4d56f8"),z=l._(M),O=["fieldProps","proFieldProps"],E=["fieldProps","proFieldProps"],I="text",U=function(e){var n=(0,N.useMountMergeState)(e.open||!1,{value:e.open,onChange:e.onOpenChange}),t=(0,k.default)(n,2),l=t[0],o=t[1];return(0,r.jsx)(B.default.Item,{shouldUpdate:!0,noStyle:!0,children:function(n){var t,a=n.getFieldValue(e.name||[]);return(0,r.jsx)(L.default,(0,f.default)((0,f.default)({getPopupContainer:function(e){return e&&e.parentNode?e.parentNode:e;},onOpenChange:function(e){return o(e);},content:(0,r.jsxs)("div",{style:{padding:"4px 0"},children:[null===(t=e.statusRender)||void 0===t?void 0:t.call(e,a),e.strengthText?(0,r.jsx)("div",{style:{marginTop:10},children:(0,r.jsx)("span",{children:e.strengthText})}):null]}),overlayStyle:{width:240},placement:"rightTop"},e.popoverProps),{},{open:l,children:e.children}));}});},V=function(e){var n=e.fieldProps,t=e.proFieldProps,l=(0,h.default)(e,O);return(0,r.jsx)(y.default,(0,f.default)({valueType:I,fieldProps:n,filedConfig:{valueType:I},proFieldProps:t},l));};V.Password=function(e){var n=e.fieldProps,t=e.proFieldProps,l=(0,h.default)(e,E),o=(0,b.useState)(!1),a=(0,k.default)(o,2),i=a[0],d=a[1];return null!=n&&n.statusRender&&l.name?(0,r.jsx)(U,{name:l.name,statusRender:null==n?void 0:n.statusRender,popoverProps:null==n?void 0:n.popoverProps,strengthText:null==n?void 0:n.strengthText,open:i,onOpenChange:d,children:(0,r.jsx)("div",{children:(0,r.jsx)(y.default,(0,f.default)({valueType:"password",fieldProps:(0,f.default)((0,f.default)({},(0,z.default)(n,["statusRender","popoverProps","strengthText"])),{},{onBlur:function(e){var t;null==n||null===(t=n.onBlur)||void 0===t||t.call(n,e),d(!1);},onClick:function(e){var t;null==n||null===(t=n.onClick)||void 0===t||t.call(n,e),d(!0);}}),proFieldProps:t,filedConfig:{valueType:I}},l))})}):(0,r.jsx)(y.default,(0,f.default)({valueType:"password",fieldProps:n,proFieldProps:t,filedConfig:{valueType:I}},l));},V.displayName="ProFormComponent";var $=t("cd05cd05"),q=t("96403d2d"),G=l._(q),W=t("be87625d"),A=l._(W),H=t("3922de01"),Q=t("8406861d"),D=t("debf9461"),J=t("9642c0f5"),K=t("ad646473"),X=l._(K);let Y=(0,H.createStyles)(({token:e,css:n})=>({page:n`
    display: flex;
    min-height: 100vh;
    background: ${e.colorBgContainer};
  `,brandPanel:n`
    position: relative;
    display: none;
    flex-direction: column;
    justify-content: center;
    width: 42%;
    min-width: 420px;
    overflow: hidden;
    padding: 64px;
    background: linear-gradient(155deg, #40a9ff 0%, #1890ff 45%, #0050b3 100%);

    @media (min-width: 992px) {
      display: flex;
    }
  `,brandBlobOne:n`
    position: absolute;
    top: -120px;
    right: -120px;
    width: 360px;
    height: 360px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
  `,brandBlobTwo:n`
    position: absolute;
    bottom: -160px;
    left: -100px;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
  `,brandContent:n`
    position: relative;
    z-index: 1;
    color: #fff;
  `,brandLogo:n`
    width: 56px;
    height: 56px;
    border-radius: 14px;
    margin-bottom: 32px;
  `,brandTitle:n`
    margin: 0 0 12px;
    font-size: 32px;
    font-weight: 700;
    color: #fff;
  `,brandSubtitle:n`
    max-width: 380px;
    font-size: 15px;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.85);
  `,formPanel:n`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 100vh;
  `,formBody:n`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
  `,formCard:n`
    width: 100%;
    max-width: 380px;
  `,mobileLogoRow:n`
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 32px;

    img {
      width: 40px;
      height: 40px;
      border-radius: 10px;
    }

    span {
      font-size: 22px;
      font-weight: 700;
      color: ${e.colorText};
    }

    @media (min-width: 992px) {
      display: none;
    }
  `})),Z=({content:e})=>(0,r.jsx)(G.default,{style:{marginBottom:24},message:e,type:"error",showIcon:!0}),ee=()=>{let[e,n]=(0,b.useState)(!1),{initialState:t,setInitialState:l}=(0,$.useModel)("@@initialState"),{styles:o}=Y(),{message:a}=A.default.useApp(),d=(0,$.useIntl)(),p=async()=>{var e;let n=await (null==t?void 0:null===(e=t.fetchUserInfo)||void 0===e?void 0:e.call(t));n&&(0,Q.flushSync)(()=>{l(e=>({...e,currentUser:n}));});},f=async e=>{try{let t=await (0,J.login)({...e,type:"account"});if("ok"===t.status){a.success("\u0110\u0103ng nh\u1EADp th\xe0nh c\xf4ng!"),await p();let e=new URL(window.location.href).searchParams;window.location.href=e.get("redirect")||"/";return;}n(!0);}catch{a.error("\u0110\u0103ng nh\u1EADp th\u1EA5t b\u1EA1i, vui l\xf2ng th\u1EED l\u1EA1i!");}};return(0,r.jsxs)("div",{className:o.page,children:[(0,r.jsx)($.Helmet,{children:(0,r.jsxs)("title",{children:[d.formatMessage({id:"menu.login",defaultMessage:"\u0110\u0103ng nh\u1EADp"}),X.default.title&&` - ${X.default.title}`]})}),(0,r.jsxs)("div",{className:o.brandPanel,children:[(0,r.jsx)("div",{className:o.brandBlobOne}),(0,r.jsx)("div",{className:o.brandBlobTwo}),(0,r.jsxs)("div",{className:o.brandContent,children:[(0,r.jsx)("img",{alt:"logo",src:"/logo.svg",className:o.brandLogo}),(0,r.jsx)("h1",{className:o.brandTitle,children:"Server Ops"}),(0,r.jsx)("p",{className:o.brandSubtitle,children:"Qu\u1EA3n l\xfd t\u1EADp trung server, domain v\xe0 Cloudflare zone cho \u0111\u1ED9i v\u1EADn h\xe0nh - \u0111\u1ED3ng b\u1ED9 d\u1EEF li\u1EC7u, ch\u1EA1y t\xe1c v\u1EE5 h\xe0ng lo\u1EA1t v\xe0 theo d\xf5i l\u1ECBch s\u1EED thao t\xe1c tr\xean c\xf9ng m\u1ED9t n\u01A1i."})]})]}),(0,r.jsxs)("div",{className:o.formPanel,children:[(0,r.jsx)("div",{className:o.formBody,children:(0,r.jsxs)("div",{className:o.formCard,children:[(0,r.jsxs)("div",{className:o.mobileLogoRow,children:[(0,r.jsx)("img",{alt:"logo",src:"/logo.svg"}),(0,r.jsx)("span",{children:"Server Ops"})]}),(0,r.jsxs)(u.LoginForm,{contentStyle:{minWidth:280,maxWidth:"100%"},submitter:{searchConfig:{submitText:"\u0110\u0103ng nh\u1EADp"}},initialValues:{autoLogin:!0},onFinish:async e=>{await f(e);},children:[e&&(0,r.jsx)(Z,{content:"Sai t\xean \u0111\u0103ng nh\u1EADp ho\u1EB7c m\u1EADt kh\u1EA9u"}),(0,r.jsx)(V,{name:"username",fieldProps:{size:"large",prefix:(0,r.jsx)(s.default,{})},placeholder:"T\xean \u0111\u0103ng nh\u1EADp",rules:[{required:!0,message:"Vui l\xf2ng nh\u1EADp t\xean \u0111\u0103ng nh\u1EADp!"}]}),(0,r.jsx)(V.Password,{name:"password",fieldProps:{size:"large",prefix:(0,r.jsx)(i.default,{})},placeholder:"M\u1EADt kh\u1EA9u",rules:[{required:!0,message:"Vui l\xf2ng nh\u1EADp m\u1EADt kh\u1EA9u!"}]}),(0,r.jsx)("div",{style:{marginBottom:24},children:(0,r.jsx)(F,{noStyle:!0,name:"autoLogin",children:"Ghi nh\u1EDB \u0111\u0103ng nh\u1EADp"})})]})]})}),(0,r.jsx)(D.Footer,{})]})]});};}}]);
//# sourceMappingURL=05793652-async.68519b82.js.map